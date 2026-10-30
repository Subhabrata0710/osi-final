// ============================================================
// OSICON Kolkata 2026 — Registration Backend
// Google Apps Script — Code.gs
// ============================================================

// --- CONFIGURATION ---
const EMAIL_FROM = 'registration@osiconkolkata.com'; // Requires alias verification in script owner's Gmail settings
const EMAIL_FROM_NAME = 'OSICON Kolkata 2026';
const EMAIL_CC = 'mukherjeerohit301@gmail.com';      // Enter comma-separated email list if multiple CCs needed
const EMAIL_BCC = '';                                // Enter comma-separated email list for BCC recipients
const UPLOAD_FOLDER_ID = '1jlrDmNUbbW_6afze0q_uwm83_tqTwzHx';                         // Optional: Google Drive folder ID to save QR code images

// ============================================================
// HANDLE INCOMING REQUESTS
// ============================================================
function doPost(e) {
  try {
    let data = {};
    if (e && e.postData && e.postData.contents) {
      try {
        // Attempt parsing standard JSON
        data = JSON.parse(e.postData.contents);
      } catch (jsonErr) {
        // Fallback to URL-encoded parameters if parsing fails
        data = e.parameter;
      }
    } else if (e && e.parameter) {
      data = e.parameter;
    }

    // Branch to file upload if action is upload
    if (data.action === 'upload') {
      const uploadResponse = handleFileUpload(data);
      return ContentService.createTextOutput(JSON.stringify(uploadResponse))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Branch to file delete if action is delete_file
    if (data.action === 'delete_file') {
      const deleteResponse = handleFileDelete(data);
      return ContentService.createTextOutput(JSON.stringify(deleteResponse))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Branch to ID Pic upload (writes to ID Pic sheet, saves to Drive, sends confirmation email without emojis)
    if (data.action === 'id_pic') {
      const idPicResponse = handleIdPicUpload(data);
      return ContentService.createTextOutput(JSON.stringify(idPicResponse))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Branch to Cricket League registration (writes to its own sheet,
    // see registerCricketPlayer() near the end of this file)
    if (data.action === 'cricket') {
      const cricketResponse = registerCricketPlayer(data);
      return ContentService.createTextOutput(JSON.stringify(cricketResponse))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const response = registerUser(data);
    
    return ContentService.createTextOutput(JSON.stringify(response))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    console.log('Global Error: ' + error.toString());
    // Trigger immediate failure alert to CC/BCC lists
    sendFailureEmail(error, e ? JSON.stringify(e.parameter || (e.postData ? e.postData.contents : '')) : 'No data');
    
    return ContentService.createTextOutput(JSON.stringify({
      success: false, 
      message: 'Server Error: ' + error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

// ============================================================
// FILE UPLOAD HANDLER
// ============================================================
function handleFileUpload(data) {
  try {
    if (!data.base64Data || !data.filename) {
      return { success: false, message: 'Missing file data or filename.' };
    }
    
    var decoded = Utilities.base64Decode(data.base64Data);
    var blob = Utilities.newBlob(decoded, data.mimeType || 'application/octet-stream', data.filename);
    
    // Save to Google Drive if UPLOAD_FOLDER_ID is configured
    if (UPLOAD_FOLDER_ID && UPLOAD_FOLDER_ID.trim().length > 0) {
      var parentFolder = DriveApp.getFolderById(UPLOAD_FOLDER_ID);
      var uploadFolderName = data.uploadType === 'poster' ? 'Poster_Uploads' : (data.uploadType === 'photo' ? 'Photo_Uploads' : (data.uploadType === 'bonafide' ? 'Bonafide_Uploads' : 'Abstract_Uploads'));
      var uploadFolders = parentFolder.getFoldersByName(uploadFolderName);
      var uploadFolder = uploadFolders.hasNext() ? uploadFolders.next() : parentFolder.createFolder(uploadFolderName);
      
      // Prepend the Registration ID to the file name to know who uploaded it
      var finalName = (data.regId ? data.regId + '_' : '') + data.filename;
      blob.setName(finalName);
      
      var file = uploadFolder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      var fileUrl = file.getUrl();
      
      // Update the Registrations Sheet with the file URL
      // Supporting MULTIPLE files: append new URL separated by newline / comma if already present
      var delegateName = '';
      var delegateEmail = '';
      var delegatePhone = '';
      
      if (data.regId) {
        var sheet = getSheet('Registrations');
        var allData = sheet.getDataRange().getValues();
        for (var i = 1; i < allData.length; i++) {
          if (allData[i][1] && allData[i][1].toString().trim().toUpperCase() === data.regId.trim().toUpperCase()) {
            var rowNum = i + 1;
            var colIndex = 18; // default Column R (18) for Abstract
            if (data.uploadType === 'poster') colIndex = 19;     // Column S (19)
            else if (data.uploadType === 'photo') colIndex = 20; // Column T (20)
            else if (data.uploadType === 'bonafide') colIndex = 21; // Column U (21)

            var existingVal = (allData[i][colIndex - 1] || '').toString().trim();
            var newVal = '';
            if (existingVal) {
              // Check if URL is already present
              var urls = existingVal.split(/[\n,]+/).map(function(u) { return u.trim(); }).filter(Boolean);
              if (urls.indexOf(fileUrl) === -1) {
                urls.push(fileUrl);
              }
              newVal = urls.join('\n');
            } else {
              newVal = fileUrl;
            }
            sheet.getRange(rowNum, colIndex).setValue(newVal);

            // Capture delegate info for the log sheet
            delegateName  = (allData[i][2] || '').toString().trim();
            delegateEmail = (allData[i][3] || '').toString().trim();
            delegatePhone = (allData[i][4] || '').toString().trim();
            break;
          }
        }
      }

      // Log this upload in a dedicated per-type sheet
      logUploadToSheet(data.uploadType, {
        regId:    (data.regId || '').toString().trim().toUpperCase(),
        name:     delegateName,
        email:    delegateEmail,
        phone:    delegatePhone,
        filename: finalName,
        fileUrl:  fileUrl
      });

      return { success: true, url: fileUrl, filename: finalName, message: 'File uploaded successfully' };
    } else {
      return { success: false, message: 'UPLOAD_FOLDER_ID is not configured in code.gs' };
    }
  } catch (err) {
    return { success: false, message: 'Upload Error: ' + err.toString() };
  }
}

// ============================================================
// LOG UPLOAD TO DEDICATED SHEET
// Creates/finds the sheet for each upload type and appends a row.
// ============================================================
function logUploadToSheet(uploadType, info) {
  try {
    var sheetNames = {
      abstract: 'Abstracts_Log',
      poster:   'Papers_Log',
      photo:    'Photos_Log',
      bonafide: 'Bonafide_Log'
    };
    var sheetName = sheetNames[uploadType] || (uploadType + '_Log');

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var logSheet = ss.getSheetByName(sheetName);

    // Create sheet with headers if it doesn't exist
    if (!logSheet) {
      logSheet = ss.insertSheet(sheetName);
      logSheet.appendRow([
        'S.No.',
        'Registration ID',
        'Delegate Name',
        'Email',
        'Phone',
        'File Name',
        'Upload Date & Time',
        'File Link'
      ]);
      // Format header row
      var headerRange = logSheet.getRange(1, 1, 1, 8);
      headerRange.setFontWeight('bold');
      headerRange.setBackground('#1a3c5e');
      headerRange.setFontColor('#ffffff');
      logSheet.setFrozenRows(1);
      logSheet.setColumnWidth(1, 60);   // S.No.
      logSheet.setColumnWidth(2, 130);  // Reg ID
      logSheet.setColumnWidth(3, 180);  // Name
      logSheet.setColumnWidth(4, 200);  // Email
      logSheet.setColumnWidth(5, 130);  // Phone
      logSheet.setColumnWidth(6, 240);  // File Name
      logSheet.setColumnWidth(7, 170);  // Date & Time
      logSheet.setColumnWidth(8, 320);  // File Link
    }

    // Next serial number = number of data rows + 1
    var lastRow = logSheet.getLastRow();
    var sNo = lastRow; // row 1 is header, so data starts from row 2 → sNo = lastRow when appending

    var uploadTime = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd-MMM-yyyy HH:mm:ss');

    logSheet.appendRow([
      sNo,
      info.regId,
      info.name,
      info.email,
      info.phone,
      info.filename,
      uploadTime,
      info.fileUrl
    ]);

    // Make the file link clickable
    var newRow = logSheet.getLastRow();
    logSheet.getRange(newRow, 8).setFormula('=HYPERLINK("' + info.fileUrl + '","View File")');

    // Send confirmation email to delegate (non-fatal)
    if (info.email) {
      sendUploadConfirmationEmail(uploadType, info);
    }

  } catch (logErr) {
    // Non-fatal: log error to console but don't fail the upload response
    console.log('logUploadToSheet Error: ' + logErr.toString());
  }
}

// ============================================================
// SEND UPLOAD CONFIRMATION EMAIL TO DELEGATE
// Triggered after each successful file upload from the dashboard.
// ============================================================
function sendUploadConfirmationEmail(uploadType, info) {
  try {
    if (!info.email) return;

    var typeLabels = {
      abstract: 'Abstract',
      poster:   'Paper / Presentation',
      photo:    'Photo / Selfie',
      bonafide: 'Bonafide Certificate'
    };
    var typeEmoji = {
      abstract: '📄',
      poster:   '📊',
      photo:    '🖼️',
      bonafide: '📜'
    };
    var typeLabel = typeLabels[uploadType] || uploadType;
    var emoji     = typeEmoji[uploadType] || '📁';

    var delegateName = info.name || 'Delegate';
    var subject = '[OSICON Kolkata 2026] ' + typeLabel + ' Received — Reg ID: ' + info.regId;

    var plainBody =
      'Dear ' + delegateName + ',\n\n' +
      'Thank you for submitting your ' + typeLabel + '. We have successfully received your file and it has been recorded against your registration.\n\n' +
      'Details:\n' +
      '  • Registration ID : ' + info.regId + '\n' +
      '  • Document Type   : ' + typeLabel + '\n' +
      '  • File Name       : ' + info.filename + '\n' +
      '  • Received On     : ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd-MMM-yyyy HH:mm:ss') + '\n\n' +
      'If you need to make any changes or have questions, please feel free to write to us at registration@osiconkolkata.com.\n\n' +
      'Warm regards,\n' +
      'Organising Committee\n' +
      'OSICON Kolkata 2026\n' +
      'Osseointegration Society of India\n' +
      '📅 27th – 29th November 2026 | 📍 Westin Kolkata';

    var htmlBody =
      '<div style="font-family: \'Segoe UI\', Arial, sans-serif; max-width: 620px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">' +

        // Header
        '<div style="background: linear-gradient(135deg, #002366 0%, #1a3c8f 100%); padding: 28px 30px; text-align: center;">' +
          '<h1 style="margin: 0; color: #ffffff; font-size: 20px; letter-spacing: 0.5px;">OSICON Kolkata 2026</h1>' +
          '<p style="margin: 6px 0 0; color: #bfcfef; font-size: 13px;">Osseointegration Society of India</p>' +
        '</div>' +

        // Body
        '<div style="padding: 30px;">' +
          '<p style="margin: 0 0 16px; font-size: 16px; color: #1e293b;">Dear <strong>' + delegateName + '</strong>,</p>' +
          '<p style="margin: 0 0 24px; font-size: 15px; line-height: 1.6; color: #374151;">' +
            'Thank you for your submission. We have successfully received your <strong>' + typeLabel + '</strong> and it has been recorded against your registration.' +
          '</p>' +

          // Receipt card
          '<div style="background: #f8fafc; border: 1px solid #e2e8f0; border-left: 4px solid #002366; border-radius: 8px; padding: 20px; margin-bottom: 24px;">' +
            '<p style="margin: 0 0 14px; font-size: 14px; font-weight: 700; color: #002366; text-transform: uppercase; letter-spacing: 0.5px;">' + ' Submission Receipt</p>' +
            '<table style="width: 100%; border-collapse: collapse; font-size: 14px; color: #374151;">' +
              '<tr><td style="padding: 6px 0; color: #6b7280; width: 42%;">Registration ID</td>' +
                  '<td style="padding: 6px 0; font-weight: 600; color: #1e293b;">' + info.regId + '</td></tr>' +
              '<tr><td style="padding: 6px 0; color: #6b7280;">Document Type</td>' +
                  '<td style="padding: 6px 0; font-weight: 600; color: #1e293b;">' + typeLabel + '</td></tr>' +
              '<tr><td style="padding: 6px 0; color: #6b7280;">File Name</td>' +
                  '<td style="padding: 6px 0; font-weight: 600; color: #1e293b; word-break: break-all;">' + info.filename + '</td></tr>' +
              '<tr><td style="padding: 6px 0; color: #6b7280;">Received On</td>' +
                  '<td style="padding: 6px 0; font-weight: 600; color: #1e293b;">' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd-MMM-yyyy HH:mm:ss') + '</td></tr>' +
            '</table>' +
          '</div>' +

          // View file button
          '<div style="text-align: center; margin: 24px 0;">' +
            '<a href="' + info.fileUrl + '" target="_blank" style="background: #002366; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-size: 14px; font-weight: 600; display: inline-block;">👁️ View Submitted File</a>' +
          '</div>' +

          // Info box
          '<div style="background-color: #f1f5f9; border-radius: 8px; padding: 15px; font-size: 13px; line-height: 1.6; color: #475569; margin-bottom: 20px;">' +
            '<strong>📅 Conference Dates:</strong> 27th – 29th November 2026<br>' +
            '<strong>📍 Venue:</strong> Westin Kolkata, India<br>' +
            '<strong>🌐 Website:</strong> <a href="https://www.osiconkolkata2026.com" style="color: #002366; text-decoration: none; font-weight: 600;">www.osiconkolkata2026.com</a>' +
          '</div>' +

          '<p style="font-size: 13px; color: #6b7280; line-height: 1.6; margin-bottom: 0;">' +
            'For any queries, reply to this email or write to us at ' +
            '<a href="mailto:registration@osiconkolkata.com" style="color: #002366;">registration@osiconkolkata.com</a>.' +
          '</p>' +
        '</div>' +

        // Footer
        '<div style="border-top: 1px solid #e2e8f0; padding: 18px 30px; text-align: center; background: #f8fafc; color: #64748b; font-size: 12px; line-height: 1.6;">' +
          '<p style="margin: 0; font-weight: 600; color: #475569;">Organising Committee — OSICON Kolkata 2026</p>' +
          '<p style="margin: 4px 0 0;">Osseointegration Society of India</p>' +
        '</div>' +

      '</div>';

    var emailOptions = {
      name:     EMAIL_FROM_NAME,
      subject:  subject,
      body:     plainBody,
      htmlBody: htmlBody
    };

    if (EMAIL_FROM && EMAIL_FROM.trim().length > 0) {
      emailOptions.from = EMAIL_FROM.trim();
    }
    // CC the admin so the organising team also sees every submission
    if (EMAIL_CC && EMAIL_CC.trim().length > 0) {
      emailOptions.cc = EMAIL_CC.trim();
    }

    if (EMAIL_FROM && EMAIL_FROM.trim().length > 0) {
      GmailApp.sendEmail(info.email, subject, plainBody, emailOptions);
    } else {
      emailOptions.to = info.email;
      MailApp.sendEmail(emailOptions);
    }

  } catch (mailErr) {
    // Non-fatal: log and continue
    console.log('sendUploadConfirmationEmail Error: ' + mailErr.toString());
  }
}

// ============================================================
// ID PIC UPLOAD HANDLER
// ============================================================
function handleIdPicUpload(data) {
  try {
    if (!data.base64Data) {
      return { success: false, message: 'Missing selfie or image data.' };
    }

    var inputName = (data.name || '').toString().trim();
    var inputEmail = (data.email || '').toString().trim();
    var regId = (data.regId || '').toString().trim().toUpperCase();
    var phone = (data.phone || '').toString().trim();

    // Look up missing details from Registrations sheet if Reg ID / Phone is not supplied
    if (inputEmail || inputName) {
      var sheet = getSheet('Registrations');
      var allData = sheet.getDataRange().getValues();
      var emailLower = inputEmail.toLowerCase();
      var nameLower = inputName.toLowerCase();

      for (var i = 1; i < allData.length; i++) {
        var rowRegId = (allData[i][1] || '').toString().trim().toUpperCase();
        var rowName = (allData[i][2] || '').toString().trim();
        var rowEmail = (allData[i][3] || '').toString().trim();
        var rowPhone = (allData[i][4] || '').toString().trim();

        var match = false;
        if (emailLower && rowEmail.toLowerCase() === emailLower) {
          match = true;
        } else if (nameLower && rowName.toLowerCase() === nameLower) {
          match = true;
        }

        if (match) {
          if (!regId && rowRegId) regId = rowRegId;
          if (!inputName && rowName) inputName = rowName;
          if (!inputEmail && rowEmail) inputEmail = rowEmail;
          if (!phone && rowPhone) phone = rowPhone;
          break;
        }
      }
    }

    if (!inputName && !inputEmail) {
      return { success: false, message: 'Please provide at least Name and Email ID.' };
    }

    var decoded = Utilities.base64Decode(data.base64Data);
    var filename = data.filename || ('IDPic_' + (regId || 'User') + '_' + new Date().getTime() + '.jpg');
    var blob = Utilities.newBlob(decoded, data.mimeType || 'image/jpeg', filename);

    if (!UPLOAD_FOLDER_ID || UPLOAD_FOLDER_ID.trim().length === 0) {
      return { success: false, message: 'UPLOAD_FOLDER_ID is not configured in code.gs' };
    }

    var parentFolder = DriveApp.getFolderById(UPLOAD_FOLDER_ID);
    var uploadFolderName = 'ID_Pic_Uploads';
    var uploadFolders = parentFolder.getFoldersByName(uploadFolderName);
    var uploadFolder = uploadFolders.hasNext() ? uploadFolders.next() : parentFolder.createFolder(uploadFolderName);

    var file = uploadFolder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    var fileUrl = file.getUrl();

    // Store in dedicated tab "ID Pic"
    logIdPicToSheet({
      name: inputName,
      regId: regId,
      email: inputEmail,
      phone: phone,
      fileUrl: fileUrl,
      filename: filename
    });

    // Also update Column T (Photo) in Registrations if Reg ID was matched
    if (regId) {
      try {
        var regSheet = getSheet('Registrations');
        var regData = regSheet.getDataRange().getValues();
        for (var j = 1; j < regData.length; j++) {
          if (regData[j][1] && regData[j][1].toString().trim().toUpperCase() === regId) {
            regSheet.getRange(j + 1, 20).setValue(fileUrl);
            break;
          }
        }
      } catch (regUpdateErr) {
        console.log('Registrations sheet photo update error: ' + regUpdateErr.toString());
      }
    }

    // Trigger confirmation email WITHOUT EMOJI
    if (inputEmail) {
      sendIdPicConfirmationEmail({
        name: inputName,
        regId: regId,
        email: inputEmail,
        phone: phone,
        fileUrl: fileUrl,
        filename: filename
      });
    }

    return {
      success: true,
      message: 'ID picture uploaded successfully and confirmation email sent.',
      fileUrl: fileUrl,
      regId: regId
    };

  } catch (err) {
    console.log('handleIdPicUpload Error: ' + err.toString());
    return { success: false, message: 'Upload Error: ' + err.toString() };
  }
}

// ============================================================
// LOG TO "ID Pic" SHEET
// Stores: S.No., Name, Reg ID, Email, Phone, Image Link, Upload Date & Time
// ============================================================
function logIdPicToSheet(info) {
  try {
    var tabName = 'ID Pic';
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(tabName);

    if (!sheet) {
      sheet = ss.insertSheet(tabName);
      sheet.appendRow([
        'S.No.',
        'Name',
        'Reg ID',
        'Email',
        'Phone No.',
        'Image Link',
        'Uploaded On'
      ]);

      var headerRange = sheet.getRange(1, 1, 1, 7);
      headerRange.setFontWeight('bold');
      headerRange.setBackground('#002366');
      headerRange.setFontColor('#ffffff');
      sheet.setFrozenRows(1);
      sheet.setColumnWidth(1, 60);
      sheet.setColumnWidth(2, 200);
      sheet.setColumnWidth(3, 130);
      sheet.setColumnWidth(4, 220);
      sheet.setColumnWidth(5, 130);
      sheet.setColumnWidth(6, 320);
      sheet.setColumnWidth(7, 180);
    }

    var lastRow = sheet.getLastRow();
    var sNo = lastRow; // Header is row 1
    var uploadTime = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd-MMM-yyyy HH:mm:ss');

    sheet.appendRow([
      sNo,
      info.name || '',
      info.regId || '',
      info.email || '',
      info.phone || '',
      info.fileUrl || '',
      uploadTime
    ]);

    var newRow = sheet.getLastRow();
    if (info.fileUrl) {
      sheet.getRange(newRow, 6).setFormula('=HYPERLINK("' + info.fileUrl + '","View Image")');
    }
  } catch (err) {
    console.log('logIdPicToSheet Error: ' + err.toString());
  }
}

// ============================================================
// SEND ID PIC CONFIRMATION EMAIL (WITHOUT EMOJI)
// ============================================================
function sendIdPicConfirmationEmail(info) {
  try {
    if (!info.email) return;

    var delegateName = info.name || 'Delegate';
    var regIdText = info.regId ? (' - Reg ID: ' + info.regId) : '';
    var subject = '[OSICON Kolkata 2026] ID Photograph Received' + regIdText;

    var plainBody =
      'Dear ' + delegateName + ',\n\n' +
      'Thank you for submitting your photograph. We have successfully received your ID picture and it has been recorded in our system.\n\n' +
      'Submission Details:\n' +
      '  - Name: ' + delegateName + '\n' +
      (info.regId ? ('  - Registration ID: ' + info.regId + '\n') : '') +
      '  - Email ID: ' + info.email + '\n' +
      (info.phone ? ('  - Phone Number: ' + info.phone + '\n') : '') +
      '  - Received On: ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd-MMM-yyyy HH:mm:ss') + '\n\n' +
      'Image Link: ' + info.fileUrl + '\n\n' +
      'If you need to make any changes or have any questions, please write to us at registration@osiconkolkata.com.\n\n' +
      'Kind regards,\n' +
      'Organising Committee\n' +
      'OSICON Kolkata 2026\n' +
      'Osseointegration Society of India\n' +
      '27th - 29th November 2026 | Westin Kolkata';

    var htmlBody =
      '<div style="font-family: \'Segoe UI\', Arial, sans-serif; max-width: 620px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">' +
        '<div style="background: #002366; padding: 28px 30px; text-align: center;">' +
          '<h1 style="margin: 0; color: #ffffff; font-size: 20px; letter-spacing: 0.5px;">OSICON Kolkata 2026</h1>' +
          '<p style="margin: 6px 0 0; color: #bfcfef; font-size: 13px;">Osseointegration Society of India</p>' +
        '</div>' +
        '<div style="padding: 30px;">' +
          '<p style="margin: 0 0 16px; font-size: 16px; color: #1e293b;">Dear <strong>' + delegateName + '</strong>,</p>' +
          '<p style="margin: 0 0 24px; font-size: 15px; line-height: 1.6; color: #374151;">' +
            'Thank you for submitting your ID photograph. We have successfully received your image and it has been recorded in our system.' +
          '</p>' +
          '<div style="background: #f8fafc; border: 1px solid #e2e8f0; border-left: 4px solid #002366; border-radius: 8px; padding: 20px; margin-bottom: 24px;">' +
            '<p style="margin: 0 0 14px; font-size: 14px; font-weight: 700; color: #002366; text-transform: uppercase; letter-spacing: 0.5px;">Submission Details</p>' +
            '<table style="width: 100%; border-collapse: collapse; font-size: 14px; color: #374151;">' +
              '<tr><td style="padding: 6px 0; color: #6b7280; width: 40%;">Name</td><td style="padding: 6px 0; font-weight: 600; color: #1e293b;">' + delegateName + '</td></tr>' +
              (info.regId ? ('<tr><td style="padding: 6px 0; color: #6b7280;">Registration ID</td><td style="padding: 6px 0; font-weight: 600; color: #1e293b;">' + info.regId + '</td></tr>') : '') +
              '<tr><td style="padding: 6px 0; color: #6b7280;">Email ID</td><td style="padding: 6px 0; font-weight: 600; color: #1e293b;">' + info.email + '</td></tr>' +
              (info.phone ? ('<tr><td style="padding: 6px 0; color: #6b7280;">Phone Number</td><td style="padding: 6px 0; font-weight: 600; color: #1e293b;">' + info.phone + '</td></tr>') : '') +
              '<tr><td style="padding: 6px 0; color: #6b7280;">Received On</td><td style="padding: 6px 0; font-weight: 600; color: #1e293b;">' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd-MMM-yyyy HH:mm:ss') + '</td></tr>' +
            '</table>' +
          '</div>' +
          '<div style="text-align: center; margin: 24px 0;">' +
            '<a href="' + info.fileUrl + '" target="_blank" style="background: #002366; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-size: 14px; font-weight: 600; display: inline-block;">View Submitted Image</a>' +
          '</div>' +
          '<div style="background-color: #f1f5f9; border-radius: 8px; padding: 15px; font-size: 13px; line-height: 1.6; color: #475569; margin-bottom: 20px;">' +
            '<strong>Conference Dates:</strong> 27th - 29th November 2026<br>' +
            '<strong>Venue:</strong> Westin Kolkata, India<br>' +
            '<strong>Website:</strong> <a href="https://www.osiconkolkata2026.com" style="color: #002366; text-decoration: none; font-weight: 600;">www.osiconkolkata2026.com</a>' +
          '</div>' +
          '<p style="font-size: 13px; color: #6b7280; line-height: 1.6; margin-bottom: 0;">' +
            'For any queries, please write to us at <a href="mailto:registration@osiconkolkata.com" style="color: #002366;">registration@osiconkolkata.com</a>.' +
          '</p>' +
        '</div>' +
        '<div style="border-top: 1px solid #e2e8f0; padding: 18px 30px; text-align: center; background: #f8fafc; color: #64748b; font-size: 12px; line-height: 1.6;">' +
          '<p style="margin: 0; font-weight: 600; color: #475569;">Organising Committee - OSICON Kolkata 2026</p>' +
          '<p style="margin: 4px 0 0;">Osseointegration Society of India</p>' +
        '</div>' +
      '</div>';

    var emailOptions = {
      name: EMAIL_FROM_NAME,
      subject: subject,
      body: plainBody,
      htmlBody: htmlBody
    };

    if (EMAIL_FROM && EMAIL_FROM.trim().length > 0) {
      emailOptions.from = EMAIL_FROM.trim();
    }
    if (EMAIL_CC && EMAIL_CC.trim().length > 0) {
      emailOptions.cc = EMAIL_CC.trim();
    }

    if (EMAIL_FROM && EMAIL_FROM.trim().length > 0) {
      GmailApp.sendEmail(info.email, subject, plainBody, emailOptions);
    } else {
      emailOptions.to = info.email;
      MailApp.sendEmail(emailOptions);
    }
  } catch (err) {
    console.log('sendIdPicConfirmationEmail Error: ' + err.toString());
  }
}

// ============================================================
// FILE DELETE HANDLER
// ============================================================
function handleFileDelete(data) {
  try {
    var regId = (data.regId || '').toString().trim().toUpperCase();
    var fileUrl = (data.fileUrl || '').toString().trim();
    var uploadType = (data.uploadType || '').toString().trim();

    if (!regId || !fileUrl) {
      return { success: false, message: 'Missing Registration ID or File URL.' };
    }

    // Try deleting or trashing the file from Google Drive
    try {
      // Extract file ID from URL (e.g., https://drive.google.com/file/d/FILE_ID/view or ?id=FILE_ID)
      var fileId = '';
      var m = fileUrl.match(/[-\w]{25,}/);
      if (m) {
        fileId = m[0];
        DriveApp.getFileById(fileId).setTrashed(true);
      }
    } catch (driveErr) {
      console.log('Drive delete warning: ' + driveErr.toString());
    }

    // Remove the file URL from Google Sheet
    var sheet = getSheet('Registrations');
    var allData = sheet.getDataRange().getValues();
    for (var i = 1; i < allData.length; i++) {
      if (allData[i][1] && allData[i][1].toString().trim().toUpperCase() === regId) {
        var rowNum = i + 1;
        var colIndices = [18, 19, 20, 21];
        if (uploadType === 'abstract') colIndices = [18];
        else if (uploadType === 'poster') colIndices = [19];
        else if (uploadType === 'photo') colIndices = [20];
        else if (uploadType === 'bonafide') colIndices = [21];

        colIndices.forEach(function(col) {
          var val = (allData[i][col - 1] || '').toString().trim();
          if (val && val.indexOf(fileUrl) !== -1) {
            var urls = val.split(/[\n,]+/).map(function(u) { return u.trim(); }).filter(Boolean);
            urls = urls.filter(function(u) { return u !== fileUrl; });
            sheet.getRange(rowNum, col).setValue(urls.join('\n'));
          }
        });
        break;
      }
    }

    return { success: true, message: 'File deleted successfully' };
  } catch (err) {
    return { success: false, message: 'Delete Error: ' + err.toString() };
  }
}

function doGet(e) {
  try {
    var action = e && e.parameter && e.parameter.action;

    // --- Login Lookup ---
    if (action === 'login') {
      return handleLoginLookup(e.parameter);
    }

    // --- User Files Lookup ---
    if (action === 'getFiles') {
      return handleGetUserFiles(e.parameter);
    }

    // --- Invoice Download Page support ---
    if (action === 'lookup') {
      return handleInvoiceLookup(e.parameter);
    }

    // --- Capacity Check ---
    if (action === 'getCapacity') {
      return handleCapacityCheck();
    }

    return ContentService.createTextOutput(JSON.stringify({
      success: true, 
      message: 'OSICON Kolkata 2026 Registration API is up and running.'
    })).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    console.log('doGet Error: ' + error.toString());
    return jsonOut({ success: false, message: 'Server Error: ' + error.toString() });
  }
}

// ============================================================
// CAPACITY LOOKUP
// ============================================================
function handleCapacityCheck() {
  var sheet = getSheet('Registrations');
  var allData = sheet.getDataRange().getValues();
  var countOsseo = 0;
  var countLecture = 0;
  var countHandsOn = 0;
  var countLectureKomal = 0;
  var countHandsOnKomal = 0;
  for (var i = 1; i < allData.length; i++) {
    var rowCategory = (allData[i][6] || '').toString();
    if (rowCategory.indexOf('Osseodensification') !== -1) {
      countOsseo++;
    }
    if (rowCategory.indexOf('Reaching Unreachables: Pterygoid, Transnasal & Fast-Track Mastery (Lecture)') !== -1) {
      countLecture++;
    }
    if (rowCategory.indexOf('Reaching Unreachables: Pterygoid, Transnasal & Fast-Track Mastery (Lecture with Hands on)') !== -1) {
      countHandsOn++;
    }
    if (rowCategory.indexOf('Dr Komal Mazumdar precon workshop Lecture') !== -1) {
      countLectureKomal++;
    }
    if (rowCategory.indexOf('Dr Komal Mazumdar precon workshop lecture with hands on') !== -1) {
      countHandsOnKomal++;
    }
  }
  return jsonOut({
    success: true,
    count: countOsseo,
    countOsseo: countOsseo,
    countLecture: countLecture,
    countHandsOn: countHandsOn,
    countLectureKomal: countLectureKomal,
    countHandsOnKomal: countHandsOnKomal
  });
}

// ============================================================
// LOGIN LOOKUP
// ============================================================
function handleLoginLookup(params) {
  var phone = normalizePhone(params.phone || '');
  var regId = (params.regId || '').toString().trim().toUpperCase();

  if (!regId || !phone) {
    return jsonOut({ success: false, message: 'Please provide both Registration ID and Phone number.' });
  }

  var sheet = getSheet('Registrations');
  var allData = sheet.getDataRange().getValues();

  for (var i = 1; i < allData.length; i++) {
    var row = allData[i];
    var rowSerial = (row[1] || '').toString().trim().toUpperCase();
    var rowPhone = normalizePhone(row[4] || '');

    if (rowSerial === regId && rowPhone === phone) {
      return jsonOut({
        success: true,
        data: {
          serialNumber: row[1],
          name: row[2],
          email: row[3],
          phone: row[4],
          abstractUrl: row[17] || '',
          posterUrl: row[18] || '',
          photoUrl: row[19] || '',
          bonafideUrl: row[20] || ''
        }
      });
    }
  }

  return jsonOut({
    success: false,
    message: 'Invalid Registration ID or Phone Number. Please try again.'
  });
}

// ============================================================
// USER FILES LOOKUP (used by dashboard.html to refresh uploaded files)
// ============================================================
function handleGetUserFiles(params) {
  var regId = (params.regId || '').toString().trim().toUpperCase();

  if (!regId) {
    return jsonOut({ success: false, message: 'Please provide Registration ID.' });
  }

  var sheet = getSheet('Registrations');
  var allData = sheet.getDataRange().getValues();

  for (var i = 1; i < allData.length; i++) {
    var row = allData[i];
    var rowSerial = (row[1] || '').toString().trim().toUpperCase();

    if (rowSerial === regId) {
      return jsonOut({
        success: true,
        data: {
          serialNumber: row[1],
          name: row[2],
          abstractUrl: row[17] || '',
          posterUrl: row[18] || '',
          photoUrl: row[19] || '',
          bonafideUrl: row[20] || ''
        }
      });
    }
  }

  return jsonOut({
    success: false,
    message: 'Registration ID not found.'
  });
}

// ============================================================
// INVOICE LOOKUP (used by invoice-download.html)
// ============================================================
// Matching rule:
//  - Email + Phone must always match a row in "Registrations".
//  - If a Reg ID (Serial No) is also supplied, it must match that same row too.
//  - If no Reg ID is supplied, Email + Phone alone is sufficient.
function handleInvoiceLookup(params) {
  var email = (params.email || '').toString().trim().toLowerCase();
  var phone = normalizePhone(params.phone || '');
  var regId = (params.regid || params.regId || '').toString().trim().toUpperCase();

  if (!email || !phone) {
    return jsonOut({ success: false, message: 'Please provide both email and phone number.' });
  }

  var sheet = getSheet('Registrations');
  var allData = sheet.getDataRange().getValues();

  for (var i = 1; i < allData.length; i++) {
    var row = allData[i];
    var rowEmail = (row[3] || '').toString().trim().toLowerCase();
    var rowPhone = normalizePhone(row[4] || '');
    var rowSerial = (row[1] || '').toString().trim().toUpperCase();

    if (rowEmail === email && rowPhone === phone) {
      // Email + Phone matched this row. If a Reg ID was supplied, it must also match.
      if (regId && rowSerial !== regId) {
        continue; // keep looking in case of a data entry edge-case
      }

      return jsonOut({
        success: true,
        data: {
          serialNumber: row[1],
          name: row[2],
          email: row[3],
          phone: row[4],
          member: row[5],
          category: row[6],
          amount: row[7],
          paymentId: row[8],
          state: row[10],
          city: row[11],
          timestamp: row[0] ? new Date(row[0]).toISOString() : ''
        }
      });
    }
  }

  return jsonOut({
    success: false,
    message: regId
      ? 'No matching registration found for the Email, Phone and Reg ID provided. Please check the details and try again.'
      : 'No matching registration found for the Email and Phone provided. Please check the details and try again.'
  });
}

// Normalizes phone numbers for comparison: strips everything but digits,
// then keeps only the last 10 digits (so +91-98765-43210, 09876543210, and
// 9876543210 are all treated as the same number).
function normalizePhone(p) {
  var digits = p.toString().replace(/\D/g, '');
  if (digits.length > 10) digits = digits.slice(-10);
  return digits;
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// GET OR CREATE REGISTRATIONS SHEET
// ============================================================
function getSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (name === 'Registrations') {
      sheet.appendRow([
        'Timestamp', 
        'Serial No', 
        'Name', 
        'Email', 
        'Phone', 
        'OSI Member No', 
        'Category', 
        'Amount', 
        'Payment ID', 
        'QR Code URL',
        'State',
        'City',
        'Check-in Date',
        'Check-out Date',
        'Voucher Code'
      ]);
      sheet.setFrozenRows(1);
    }
  }
  return sheet;
}

// ============================================================
// REGISTER USER
// ============================================================
function registerUser(data) {
  if (!data || !data.email) return { success: false, message: 'No registration data provided.' };

  const lock = LockService.getScriptLock();
  try {
    // Acquire a script lock for 30s to avoid database race conditions/collisions
    lock.waitLock(30000);
    const sheet = getSheet('Registrations');
    const allData = sheet.getDataRange().getValues();

    // Duplicate Check: compare with column index 3 (Email)
    for (var i = 1; i < allData.length; i++) {
      if (allData[i][3] && allData[i][3].toString().toLowerCase().trim() === data.email.toLowerCase().trim()) {
        return { success: false, message: 'This email is already registered!' };
      }
    }

    // Capacity Check for Osseodensification
    if (data.category && data.category.indexOf('Osseodensification') !== -1) {
      var count = 0;
      for (var j = 1; j < allData.length; j++) {
        var rowCat = (allData[j][6] || '').toString();
        if (rowCat.indexOf('Osseodensification') !== -1) {
          count++;
        }
      }
      if (count >= 20) {
        return { success: false, message: 'Sorry, the Osseodensification course is sold out (Max 30 delegates reached).' };
      }
    }

    // Capacity Check for Reaching Unreachables (Lecture)
    if (data.category && data.category.indexOf('Reaching Unreachables: Pterygoid, Transnasal & Fast-Track Mastery (Lecture)') !== -1) {
      var countLec = 0;
      for (var j = 1; j < allData.length; j++) {
        var rowCat = (allData[j][6] || '').toString();
        if (rowCat.indexOf('Reaching Unreachables: Pterygoid, Transnasal & Fast-Track Mastery (Lecture)') !== -1) {
          countLec++;
        }
      }
      if (countLec >= 30) {
        return { success: false, message: 'Sorry, the Reaching Unreachables Lecture is sold out (Max 30 delegates reached).' };
      }
    }

    // Capacity Check for Reaching Unreachables (Hands on)
    if (data.category && data.category.indexOf('Reaching Unreachables: Pterygoid, Transnasal & Fast-Track Mastery (Lecture with Hands on)') !== -1) {
      var countHO = 0;
      for (var j = 1; j < allData.length; j++) {
        var rowCat = (allData[j][6] || '').toString();
        if (rowCat.indexOf('Reaching Unreachables: Pterygoid, Transnasal & Fast-Track Mastery (Lecture with Hands on)') !== -1) {
          countHO++;
        }
      }
      if (countHO >= 30) {
        return { success: false, message: 'Sorry, the Reaching Unreachables Hands-on is sold out (Max 30 delegates reached).' };
      }
    }

    var rowNum = allData.length;
    var prefix = 'OSI';
    var serialNumber = prefix + '-' + (1000 + rowNum);

    // QR Code generation utilizing QuickChart
    var qrText = 'OSICON Kolkata 2026\nReg ID: ' + serialNumber + '\nName: ' + (data.name || '') +
      '\nCategory: ' + (data.category || '') + '\nAmount: Rs. ' + (data.amount || 0);
    var qrApiUrl = 'https://quickchart.io/qr?text=' + encodeURIComponent(qrText) + '&margin=2&size=300';
    var savedQrUrl = qrApiUrl;
    var globalQrBlob = null;

    try {
      var response = UrlFetchApp.fetch(qrApiUrl);
      globalQrBlob = response.getBlob().getAs(MimeType.PNG).setName('QR_' + serialNumber + '.png');
      
      // Save to Google Drive if UPLOAD_FOLDER_ID is configured
      if (UPLOAD_FOLDER_ID && UPLOAD_FOLDER_ID.trim().length > 0) {
        var parentFolder = DriveApp.getFolderById(UPLOAD_FOLDER_ID);
        var qrFolders = parentFolder.getFoldersByName('QR');
        var qrFolder = qrFolders.hasNext() ? qrFolders.next() : parentFolder.createFolder('QR');
        var qrFile = qrFolder.createFile(globalQrBlob);
        qrFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        savedQrUrl = qrFile.getUrl();
      }
    } catch (qrErr) {
      console.log('QR Code processing failed: ' + qrErr.toString());
    }

    // Append standard row to Spreadsheet
    sheet.appendRow([
      new Date(),
      serialNumber,
      data.name || '',
      data.email || '',
      data.phone || '',
      data.member || '',
      data.category || '',
      data.amount || 0,
      data.payment_id || '',
      savedQrUrl,
      data.state || '',
      data.city || '',
      data.checkinDate || '',
      data.checkoutDate || '',
      data.voucherCode || ''
    ]);

    // Send confirmation email
    try {
      sendConfirmationEmail(data, serialNumber, savedQrUrl, globalQrBlob);
    } catch (emailErr) {
      console.log('Email sending failed, but database record saved: ' + emailErr.toString());
    }

    return {
      success: true,
      message: 'Registration successful! Confirmation email has been sent.',
      serialNumber: serialNumber
    };

  } catch (e) {
    console.log('Registration Error: ' + e.toString());
    sendFailureEmail(e, JSON.stringify(data));
    return { success: false, message: 'Registration failed: ' + e.toString() };
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// SEND CONFIRMATION EMAIL
// ============================================================
function sendConfirmationEmail(data, serialNumber, savedQrUrl, qrBlob) {
  var subject = 'Registration Confirmation — OSICON Kolkata 2026 [' + serialNumber + ']';
  var inlineBlob = null, attachBlob = null, hasQr = false;

  if (qrBlob) {
    try {
      inlineBlob = qrBlob.copyBlob().setName('qrCode.png');
      attachBlob = qrBlob.copyBlob().setName('OSICON_QR_' + serialNumber + '.png');
      hasQr = true;
    } catch (e) { 
      console.log('QR blob copy failed: ' + e.toString()); 
    }
  }

  // Premium Plain Text version
  var plainBody =
    'Dear ' + data.name + ',\n\n' +
    'Thank you for registering for the 3rd Annual Conference of the Osseointegration Society of India (OSICON Kolkata 2026)!\n\n' +
    'Your registration has been confirmed. Details:\n' +
    '────────────────────────────────────────────────\n' +
    'Registration ID : ' + serialNumber + '\n' +
    'Category        : ' + (data.category || '') + '\n' +
    'OSI Member No   : ' + (data.member || 'N/A') + '\n' +
    'State           : ' + (data.state || 'N/A') + '\n' +
    'City            : ' + (data.city || 'N/A') + '\n' +
    'Amount Paid     : ₹' + data.amount + '\n' +
    'Payment ID      : ' + (data.payment_id || 'N/A') + '\n' +
    '────────────────────────────────────────────────\n\n' +
    (savedQrUrl ? 'QR Code URL: ' + savedQrUrl + '\n\n' : '') +
    (hasQr ? 'Please present the attached QR code at the registration desk for entry.\n\n' : '') +
    'Event details:\n' +
    'Dates: 27th - 29th November 2026\n' +
    'Venue: Kolkata\n' +
    'Website: www.osiconkolkata2026.com\n\n' +
    'We look forward to welcoming you to the cultural capital of India!\n\n' +
    'Best regards,\n' +
    'Organizing Committee\n' +
    'OSICON Kolkata 2026\n' +
    'Email: registration@osiconkolkata.com';

  // Premium Responsive HTML template with modern layout and OSICON colors
  var htmlBody = 
    '<div style="font-family: \'Inter\', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff; color: #1a202c;">' +
      // Header Banner
      '<div style="background: linear-gradient(135deg, #002366 0%, #0c4a6e 100%); padding: 30px; border-radius: 8px 8px 0 0; text-align: center; color: #ffffff;">' +
        '<h2 style="margin: 0; font-size: 24px; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase;">OSICON Kolkata 2026</h2>' +
        '<p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.9;">3rd Annual Conference of Osseointegration Society of India</p>' +
      '</div>' +
      
      // Main Body Content
      '<div style="padding: 24px 10px;">' +
        '<p style="font-size: 16px; line-height: 1.6; margin-top: 0;">Dear <strong>' + data.name + '</strong>,</p>' +
        '<p style="font-size: 15px; line-height: 1.6;">Thank you for registering for the prestigious <strong>OSICON Kolkata 2026</strong>. We are thrilled to confirm your registration for this highlight annual event!</p>' +
        
        // Registration Summary Card
        '<div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 24px 0;">' +
          '<h3 style="margin-top: 0; margin-bottom: 15px; font-size: 16px; border-bottom: 2px solid #cbd5e1; padding-bottom: 6px; color: #002366;">Registration Details</h3>' +
          '<table style="width: 100%; font-size: 14px; border-collapse: collapse;">' +
            '<tr><td style="padding: 6px 0; font-weight: 600; width: 140px; color: #475569;">Registration ID</td><td style="padding: 6px 0; font-weight: 700; color: #0f172a;">' + serialNumber + '</td></tr>' +
            '<tr><td style="padding: 6px 0; font-weight: 600; color: #475569;">Category</td><td style="padding: 6px 0; color: #0f172a;">' + (data.category || '') + '</td></tr>' +
            '<tr><td style="padding: 6px 0; font-weight: 600; color: #475569;">OSI Member No</td><td style="padding: 6px 0; color: #0f172a;">' + (data.member || 'N/A') + '</td></tr>' +
            '<tr><td style="padding: 6px 0; font-weight: 600; color: #475569;">State</td><td style="padding: 6px 0; color: #0f172a;">' + (data.state || 'N/A') + '</td></tr>' +
            '<tr><td style="padding: 6px 0; font-weight: 600; color: #475569;">City</td><td style="padding: 6px 0; color: #0f172a;">' + (data.city || 'N/A') + '</td></tr>' +
            '<tr><td style="padding: 6px 0; font-weight: 600; color: #475569;">Amount Paid</td><td style="padding: 6px 0; font-weight: 700; color: #002366;">₹' + new Intl.NumberFormat('en-IN').format(data.amount) + '</td></tr>' +
            '<tr><td style="padding: 6px 0; font-weight: 600; color: #475569;">Payment ID</td><td style="padding: 6px 0; font-family: monospace; color: #0f172a;">' + (data.payment_id || 'N/A') + '</td></tr>' +
          '</table>' +
        '</div>';

  if (hasQr) {
    htmlBody += 
        // Inline QR Code Section
        '<div style="text-align: center; margin: 30px 0; padding: 20px; border: 1px dashed #cbd5e1; border-radius: 8px; background-color: #fafafa;">' +
          '<p style="margin: 0 0 12px 0; font-size: 14px; font-weight: 600; color: #475569;">Your Event Entrance QR Code</p>' +
          '<img src="cid:qrCode" alt="Event QR Code" style="width: 180px; height: 180px; border: 1px solid #e2e8f0; display: inline-block;" />' +
          '<p style="margin: 10px 0 0 0; font-size: 12px; color: #64748b;">Please present this code at the registration desk for verification.</p>' +
        '</div>';
  }

  htmlBody +=
        // Event Logistics
        '<div style="background-color: #f1f5f9; border-radius: 8px; padding: 15px; margin: 24px 0; font-size: 14px; line-height: 1.5;">' +
          '<strong>📅 Conference Dates:</strong> 27th - 29th November 2026<br>' +
          '<strong>📍 Venue Location:</strong> Westin Kolkata, India<br>' +
          '<strong>🌐 Website:</strong> <a href="https://www.osiconkolkata2026.com" style="color: #002366; text-decoration: none; font-weight: 600;">www.osiconkolkata2026.com</a>' +
        '</div>' +
        
        '<p style="font-size: 14px; line-height: 1.6; margin-bottom: 0;">If you have any questions or require additional assistance, feel free to reply to this email or reach us at <a href="mailto:registration@osiconkolkata.com" style="color: #002366;">registration@osiconkolkata.com</a>.</p>' +
      '</div>' +
      
      // Footer
      '<div style="border-top: 1px solid #e2e8f0; padding-top: 20px; text-align: center; color: #64748b; font-size: 13px; line-height: 1.5;">' +
        '<p style="margin: 0; font-weight: 600; color: #475569;">Organizing Committee — OSICON Kolkata 2026</p>' +
        '<p style="margin: 4px 0 0 0;">Osseointegration Society of India</p>' +
      '</div>' +
    '</div>';

  var emailOptions = {
    to: data.email,
    name: EMAIL_FROM_NAME,
    subject: subject,
    body: plainBody,
    htmlBody: htmlBody
  };

  if (hasQr) {
    emailOptions.inlineImages = { qrCode: inlineBlob };
    emailOptions.attachments = [attachBlob];
  }

  // Dynamically set From Alias if configured
  if (EMAIL_FROM && EMAIL_FROM.trim().length > 0) {
    emailOptions.from = EMAIL_FROM.trim();
  }

  // Set CC configuration (handles multiple comma-separated emails flawlessly)
  if (EMAIL_CC && EMAIL_CC.trim().length > 0) {
    emailOptions.cc = EMAIL_CC.trim();
  }

  // Set BCC configuration (handles multiple comma-separated emails flawlessly)
  if (EMAIL_BCC && EMAIL_BCC.trim().length > 0) {
    emailOptions.bcc = EMAIL_BCC.trim();
  }

  // Use GmailApp to support custom sender aliases (via from option)
  if (EMAIL_FROM && EMAIL_FROM.trim().length > 0) {
    GmailApp.sendEmail(data.email, subject, plainBody, emailOptions);
  } else {
    MailApp.sendEmail(emailOptions);
  }
}

// ============================================================
// SEND FAILURE EMAIL (CRITICAL SERVER ERROR ALERTS)
// ============================================================
function sendFailureEmail(error, rawData) {
  try {
    var subject = '[OSICON Kolkata 2026] Registration Error Alert';
    var plainBody = 
      'WARNING: OSICON Kolkata 2026 backend experienced an unexpected server error during registration processing.\n\n' +
      'Error Message:\n' + error.toString() + '\n\n' +
      'Raw Payload Data:\n' + rawData + '\n\n' +
      'Please verify this payment ID in your payment gateway and manually record this attendee if required.';

    var htmlBody = 
      '<div style="font-family: Arial, sans-serif; border: 2px solid #ef4444; border-radius: 8px; padding: 20px; background-color: #fef2f2; color: #991b1b; max-width: 600px;">' +
        '<h3 style="margin-top: 0; color: #dc2626;">🚨 Registration Error Alert</h3>' +
        '<p><strong>Error Message:</strong></p>' +
        '<pre style="background-color: #ffffff; padding: 12px; border: 1px solid #fca5a5; border-radius: 4px; color: #7f1d1d; overflow-x: auto;">' + error.toString() + '</pre>' +
        '<p><strong>Received Payload:</strong></p>' +
        '<pre style="background-color: #ffffff; padding: 12px; border: 1px solid #fca5a5; border-radius: 4px; color: #7f1d1d; overflow-x: auto;">' + rawData + '</pre>' +
        '<p style="font-size: 13px; color: #b91c1c; margin-bottom: 0;">Please check the Google Sheets file status, Apps Script logs, and verify the corresponding payment ID in the Razorpay dashboard immediately.</p>' +
      '</div>';

    var emailOptions = {
      name: EMAIL_FROM_NAME,
      htmlBody: htmlBody
    };

    if (EMAIL_FROM && EMAIL_FROM.trim().length > 0) {
      emailOptions.from = EMAIL_FROM.trim();
    }
    
    if (EMAIL_CC && EMAIL_CC.trim().length > 0) {
      emailOptions.cc = EMAIL_CC.trim();
    }

    if (EMAIL_BCC && EMAIL_BCC.trim().length > 0) {
      emailOptions.bcc = EMAIL_BCC.trim();
    }

    // Determine the admin target (default to primary CC address if set, else script owner)
    var adminTo = (EMAIL_CC && EMAIL_CC.trim().length > 0) ? EMAIL_CC.trim().split(',')[0] : Session.getActiveUser().getEmail();

    if (EMAIL_FROM && EMAIL_FROM.trim().length > 0) {
      GmailApp.sendEmail(adminTo, subject, plainBody, emailOptions);
    } else {
      MailApp.sendEmail({
        to: adminTo,
        cc: EMAIL_CC,
        bcc: EMAIL_BCC,
        name: EMAIL_FROM_NAME,
        subject: subject,
        body: plainBody
      });
    }
  } catch (e) { 
    console.log('Failure alert email also failed: ' + e.toString()); 
  }
}
// ============================================================
// >>> ADD THIS TO THE END OF OSI's Code.gs <<<
// Nothing above this line is touched. registerUser(), doPost(),
// doGet(), sendConfirmationEmail(), sendFailureEmail(), getSheet(),
// etc. are all left exactly as they are.
//
// FEATURE: Writing "send" in column P of the "Registrations" sheet
// re-sends the confirmation email for that row, with the SAME body,
// CC, BCC and from-alias as the normal registration email — the only
// difference is the QR code, which now encodes ONLY the Registration
// ID (instead of the full name/category/amount text), sent as an
// inline + attached image. The existing QR link (column J) is still
// shown as a clickable link in the email too, just like today.
//
// SETUP REQUIRED (one-time, in the Apps Script editor):
//   1. Click the clock icon (Triggers) on the left sidebar.
//   2. + Add Trigger
//        Function to run:      onOsiRegistrationEdit
//        Event source:         From spreadsheet
//        Event type:           On edit
//   3. Save. (This must be an INSTALLABLE trigger — a plain onEdit()
//      simple trigger is not allowed to send email in Apps Script.)
//   4. Optional: add "Action" as the header in P1 and "Status" in Q1
//      of the Registrations sheet — purely cosmetic, the code doesn't
//      require it.
//
// USAGE: In any registration row, type "send" in column P. After
// ~1 minute, column Q will update to "Success ..." or "Failed: ...".
// ============================================================

function onOsiRegistrationEdit(e) {
  if (!e || !e.range) return;

  const sheet = e.range.getSheet();
  if (sheet.getName() !== 'Registrations') return;

  const col = e.range.getColumn();
  if (col !== 16) return; // Column P = Action

  const val = (e.value || '').toString().toLowerCase().trim();
  if (val !== 'send') return;

  const row = e.range.getRow();
  if (row <= 1) return;

  // Feedback while we wait, same pattern as the PEDICON script
  sheet.getRange(row, 17).setValue('Pending (1 min delay)...'); // Column Q

  const trigger = ScriptApp.newTrigger('processOsiSendAction')
    .timeBased()
    .after(60000)
    .create();

  PropertiesService.getScriptProperties().setProperty(
    trigger.getUniqueId(),
    JSON.stringify({ row: row })
  );
}

function processOsiSendAction(e) {
  const triggerId = e.triggerUid;
  const props = PropertiesService.getScriptProperties();
  const dataStr = props.getProperty(triggerId);

  // Always clean up the trigger so it doesn't pile up
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getUniqueId() === triggerId) {
      ScriptApp.deleteTrigger(triggers[i]);
      break;
    }
  }
  if (!dataStr) return;

  const tData = JSON.parse(dataStr);
  props.deleteProperty(triggerId);

  const row = tData.row;
  const sheet = getSheet('Registrations'); // reuses your existing, unmodified helper
  if (!sheet) return;

  const rowData = sheet.getRange(row, 1, 1, 15).getValues()[0];

  const rowInfo = {
    name: rowData[2],        // C
    email: rowData[3],       // D
    phone: rowData[4],       // E
    member: rowData[5],      // F
    category: rowData[6],    // G
    amount: rowData[7],      // H
    payment_id: rowData[8],  // I
    state: rowData[10],      // K
    city: rowData[11]        // L
  };
  const serialNumber = rowData[1]; // B
  const existingQrUrl = rowData[9]; // J - existing QR Code URL/link

  try {
    sendLinkQrConfirmationEmail(rowInfo, serialNumber, existingQrUrl);
    sheet.getRange(row, 17).setValue('Success ' + new Date().toISOString());
  } catch (err) {
    sheet.getRange(row, 17).setValue('Failed: ' + err.toString() + ' ' + new Date().toISOString());
  }
}

// ============================================================
// SAME body / CC / BCC / from-alias as sendConfirmationEmail().
// Only the QR is different: it encodes ONLY the Registration ID.
// ============================================================
function sendLinkQrConfirmationEmail(data, serialNumber, existingQrUrl) {
  var subject = 'Registration Confirmation — OSICON Kolkata 2026 [' + serialNumber + ']';

  // QR encodes ONLY the Reg ID this time
  var qrApiUrl = 'https://quickchart.io/qr?text=' + encodeURIComponent(serialNumber) + '&margin=2&size=300';
  var inlineBlob = null, attachBlob = null, hasQr = false;

  try {
    var response = UrlFetchApp.fetch(qrApiUrl);
    var qrBlob = response.getBlob().getAs(MimeType.PNG).setName('QR_' + serialNumber + '.png');
    inlineBlob = qrBlob.copyBlob().setName('qrCode.png');
    attachBlob = qrBlob.copyBlob().setName('OSICON_QR_' + serialNumber + '.png');
    hasQr = true;
  } catch (qrErr) {
    console.log('Link-based QR generation failed, falling back to link only: ' + qrErr.toString());
  }

  var plainBody =
    'Dear ' + data.name + ',\n\n' +
    'Thank you for registering for the 3rd Annual Conference of the Osseointegration Society of India (OSICON Kolkata 2026)!\n\n' +
    'Your registration has been confirmed. Details:\n' +
    '────────────────────────────────────────────────\n' +
    'Registration ID : ' + serialNumber + '\n' +
    'Category        : ' + (data.category || '') + '\n' +
    'OSI Member No   : ' + (data.member || 'N/A') + '\n' +
    'State           : ' + (data.state || 'N/A') + '\n' +
    'City            : ' + (data.city || 'N/A') + '\n' +
    'Amount Paid     : ₹' + data.amount + '\n' +
    'Payment ID      : ' + (data.payment_id || 'N/A') + '\n' +
    '────────────────────────────────────────────────\n\n' +
    (existingQrUrl ? 'QR Code URL: ' + existingQrUrl + '\n\n' : '') +
    (hasQr ? 'Please present the attached QR code at the registration desk for entry.\n\n' : '') +
    'Event details:\n' +
    'Dates: 27th - 29th November 2026\n' +
    'Venue: Kolkata\n' +
    'Website: www.osiconkolkata2026.com\n\n' +
    'We look forward to welcoming you to the cultural capital of India!\n\n' +
    'Best regards,\n' +
    'Organizing Committee\n' +
    'OSICON Kolkata 2026\n' +
    'Email: registration@osiconkolkata.com';

  var htmlBody =
    '<div style="font-family: \'Inter\', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff; color: #1a202c;">' +
      '<div style="background: linear-gradient(135deg, #002366 0%, #0c4a6e 100%); padding: 30px; border-radius: 8px 8px 0 0; text-align: center; color: #ffffff;">' +
        '<h2 style="margin: 0; font-size: 24px; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase;">OSICON Kolkata 2026</h2>' +
        '<p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.9;">3rd Annual Conference of Osseointegration Society of India</p>' +
      '</div>' +
      '<div style="padding: 24px 10px;">' +
        '<p style="font-size: 16px; line-height: 1.6; margin-top: 0;">Dear <strong>' + data.name + '</strong>,</p>' +
        '<p style="font-size: 15px; line-height: 1.6;">Thank you for registering for the prestigious <strong>OSICON Kolkata 2026</strong>. We are thrilled to confirm your registration for this highlight annual event!</p>' +
        '<div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 24px 0;">' +
          '<h3 style="margin-top: 0; margin-bottom: 15px; font-size: 16px; border-bottom: 2px solid #cbd5e1; padding-bottom: 6px; color: #002366;">Registration Details</h3>' +
          '<table style="width: 100%; font-size: 14px; border-collapse: collapse;">' +
            '<tr><td style="padding: 6px 0; font-weight: 600; width: 140px; color: #475569;">Registration ID</td><td style="padding: 6px 0; font-weight: 700; color: #0f172a;">' + serialNumber + '</td></tr>' +
            '<tr><td style="padding: 6px 0; font-weight: 600; color: #475569;">Category</td><td style="padding: 6px 0; color: #0f172a;">' + (data.category || '') + '</td></tr>' +
            '<tr><td style="padding: 6px 0; font-weight: 600; color: #475569;">OSI Member No</td><td style="padding: 6px 0; color: #0f172a;">' + (data.member || 'N/A') + '</td></tr>' +
            '<tr><td style="padding: 6px 0; font-weight: 600; color: #475569;">State</td><td style="padding: 6px 0; color: #0f172a;">' + (data.state || 'N/A') + '</td></tr>' +
            '<tr><td style="padding: 6px 0; font-weight: 600; color: #475569;">City</td><td style="padding: 6px 0; color: #0f172a;">' + (data.city || 'N/A') + '</td></tr>' +
            '<tr><td style="padding: 6px 0; font-weight: 600; color: #475569;">Amount Paid</td><td style="padding: 6px 0; font-weight: 700; color: #002366;">₹' + new Intl.NumberFormat('en-IN').format(data.amount) + '</td></tr>' +
            '<tr><td style="padding: 6px 0; font-weight: 600; color: #475569;">Payment ID</td><td style="padding: 6px 0; font-family: monospace; color: #0f172a;">' + (data.payment_id || 'N/A') + '</td></tr>' +
          '</table>' +
        '</div>';

  if (hasQr) {
    htmlBody +=
        '<div style="text-align: center; margin: 30px 0; padding: 20px; border: 1px dashed #cbd5e1; border-radius: 8px; background-color: #fafafa;">' +
          '<p style="margin: 0 0 12px 0; font-size: 14px; font-weight: 600; color: #475569;">Your Event Entrance QR Code</p>' +
          '<img src="cid:qrCode" alt="Event QR Code" style="width: 180px; height: 180px; border: 1px solid #e2e8f0; display: inline-block;" />' +
          '<p style="margin: 10px 0 0 0; font-size: 12px; color: #64748b;">Please present this code at the registration desk for verification.</p>' +
        '</div>';
  }

  htmlBody +=
        '<div style="background-color: #f1f5f9; border-radius: 8px; padding: 15px; margin: 24px 0; font-size: 14px; line-height: 1.5;">' +
          '<strong>📅 Conference Dates:</strong> 27th - 29th November 2026<br>' +
          '<strong>📍 Venue Location:</strong> Westin Kolkata, India<br>' +
          '<strong>🌐 Website:</strong> <a href="https://www.osiconkolkata2026.com" style="color: #002366; text-decoration: none; font-weight: 600;">www.osiconkolkata2026.com</a>' +
        '</div>' +
        '<p style="font-size: 14px; line-height: 1.6; margin-bottom: 0;">If you have any questions or require additional assistance, feel free to reply to this email or reach us at <a href="mailto:registration@osiconkolkata.com" style="color: #002366;">registration@osiconkolkata.com</a>.</p>' +
      '</div>' +
      '<div style="border-top: 1px solid #e2e8f0; padding-top: 20px; text-align: center; color: #64748b; font-size: 13px; line-height: 1.5;">' +
        '<p style="margin: 0; font-weight: 600; color: #475569;">Organizing Committee — OSICON Kolkata 2026</p>' +
        '<p style="margin: 4px 0 0 0;">Osseointegration Society of India</p>' +
      '</div>' +
    '</div>';

  var emailOptions = {
    to: data.email,
    name: EMAIL_FROM_NAME,
    subject: subject,
    body: plainBody,
    htmlBody: htmlBody
  };

  if (hasQr) {
    emailOptions.inlineImages = { qrCode: inlineBlob };
    emailOptions.attachments = [attachBlob];
  }

  if (EMAIL_FROM && EMAIL_FROM.trim().length > 0) {
    emailOptions.from = EMAIL_FROM.trim();
  }
  if (EMAIL_CC && EMAIL_CC.trim().length > 0) {
    emailOptions.cc = EMAIL_CC.trim();
  }
  if (EMAIL_BCC && EMAIL_BCC.trim().length > 0) {
    emailOptions.bcc = EMAIL_BCC.trim();
  }

  if (EMAIL_FROM && EMAIL_FROM.trim().length > 0) {
    GmailApp.sendEmail(data.email, subject, plainBody, emailOptions);
  } else {
    MailApp.sendEmail(emailOptions);
  }
}
// ============================================================
// >>> ADDED: OSICON CRICKET LEAGUE 2026 — PLAYER REGISTRATION <<<
// Nothing above this line is touched. This writes to its own
// "Cricket Registrations" sheet in the same spreadsheet and is
// completely separate from the conference "Registrations" sheet.
// Hooked into doPost() via `data.action === 'cricket'` (see the
// small branch added near the top of doPost()).
//
// This is a free/complimentary registration — no payment, no QR
// code — so the flow is intentionally simpler than registerUser().
// ============================================================

const CRICKET_SHEET_NAME = 'Cricket Registrations';

// ------------------------------------------------------------
// GET OR CREATE THE "Cricket Registrations" SHEET
// ------------------------------------------------------------
function getCricketSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CRICKET_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CRICKET_SHEET_NAME);
    sheet.appendRow([
      'Timestamp',
      'Full Name',
      'Age',
      'Gender',
      'Mobile Number',
      'Email',
      'City',
      'Registered OSICON Participant?',
      'Accompanying Participant Name',
      'OSICON Registration No.',
      'Registration Type',
      'Team Category',
      'Team Name',
      'Team Captain Name',
      "Captain's Mobile Number",
      'Number of Players',
      'Names of Team Members',
      'Team Captain Confirmed',
      'Eligibility Consent'
    ]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// ------------------------------------------------------------
// REGISTER A CRICKET LEAGUE ENTRY (team or individual)
// ------------------------------------------------------------
function registerCricketPlayer(data) {
  if (!data || !data.email || !data.name) {
    return { success: false, message: 'Missing required registration data.' };
  }

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const sheet = getCricketSheet();
    const allData = sheet.getDataRange().getValues();

    // Duplicate check on Email (column index 5)
    for (var i = 1; i < allData.length; i++) {
      if (allData[i][5] && allData[i][5].toString().toLowerCase().trim() === data.email.toLowerCase().trim()) {
        return { success: false, message: 'This email has already been used for a Cricket League registration!' };
      }
    }

    sheet.appendRow([
      new Date(),
      data.name || '',
      data.age || '',
      data.gender || '',
      data.mobile || '',
      data.email || '',
      data.city || '',
      data.participantStatus || '',
      data.accompanyingName || '',
      data.regNo || '',
      data.registrationType || '',
      data.teamCategory || '',
      data.teamName || '',
      data.captainName || '',
      data.captainMobile || '',
      data.numPlayers || '',
      data.teamMembers || '',
      data.teamConfirm || '',
      data.consent || ''
    ]);

    // Send confirmation email (failure here should not fail the registration)
    try {
      sendCricketConfirmationEmail(data);
    } catch (emailErr) {
      console.log('Cricket confirmation email failed, but record was saved: ' + emailErr.toString());
    }

    return {
      success: true,
      message: 'Registration successful! A confirmation email has been sent.'
    };

  } catch (e) {
    console.log('Cricket Registration Error: ' + e.toString());
    sendFailureEmail(e, JSON.stringify(data));
    return { success: false, message: 'Registration failed: ' + e.toString() };
  } finally {
    lock.releaseLock();
  }
}

// ------------------------------------------------------------
// CRICKET LEAGUE CONFIRMATION EMAIL
// ------------------------------------------------------------
function sendCricketConfirmationEmail(data) {
  var subject = 'OSICON Cricket League 2026 — Registration Received';
  var isTeam = (data.registrationType || '').toLowerCase().indexOf('team') !== -1;

  var plainBody =
    'Dear ' + data.name + ',\n\n' +
    'Thank you for registering for the OSICON Cricket League 2026!\n\n' +
    'Details received:\n' +
    '────────────────────────────────────────────────\n' +
    'Registration Type : ' + (data.registrationType || '') + '\n' +
    (isTeam ? 'Team Name          : ' + (data.teamName || '') + '\n' : '') +
    (isTeam ? 'Team Category      : ' + (data.teamCategory || '') + '\n' : '') +
    'Gender Category    : ' + (data.gender || '') + '\n' +
    'Mobile Number      : ' + (data.mobile || '') + '\n' +
    'City               : ' + (data.city || '') + '\n' +
    '────────────────────────────────────────────────\n\n' +
    'Teams will be finalized through a lucky draw after the registration cut-off date. ' +
    'We will be in touch with further details closer to the event.\n\n' +
    'See you on the pitch! 🏆\n\n' +
    'Best regards,\n' +
    'Organizing Committee\n' +
    'OSICON Kolkata 2026\n' +
    'Email: registration@osiconkolkata.com';

  var htmlBody =
    '<div style="font-family: \'Inter\', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff; color: #1a202c;">' +
      '<div style="background: linear-gradient(135deg, #002366 0%, #0c4a6e 100%); padding: 30px; border-radius: 8px 8px 0 0; text-align: center; color: #ffffff;">' +
        '<h2 style="margin: 0; font-size: 22px; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase;">OSICON Cricket League 2026</h2>' +
        '<p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.9;">Player Registration Confirmation</p>' +
      '</div>' +
      '<div style="padding: 24px 10px;">' +
        '<p style="font-size: 16px; line-height: 1.6; margin-top: 0;">Dear <strong>' + data.name + '</strong>,</p>' +
        '<p style="font-size: 15px; line-height: 1.6;">Thank you for registering for the <strong>OSICON Cricket League 2026</strong>. Your details have been received successfully.</p>' +
        '<div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 24px 0;">' +
          '<h3 style="margin-top: 0; margin-bottom: 15px; font-size: 16px; border-bottom: 2px solid #cbd5e1; padding-bottom: 6px; color: #002366;">Registration Summary</h3>' +
          '<table style="width: 100%; font-size: 14px; border-collapse: collapse;">' +
            '<tr><td style="padding: 6px 0; font-weight: 600; width: 170px; color: #475569;">Registration Type</td><td style="padding: 6px 0; color: #0f172a;">' + (data.registrationType || '') + '</td></tr>' +
            (isTeam ? '<tr><td style="padding: 6px 0; font-weight: 600; color: #475569;">Team Name</td><td style="padding: 6px 0; color: #0f172a;">' + (data.teamName || '') + '</td></tr>' : '') +
            (isTeam ? '<tr><td style="padding: 6px 0; font-weight: 600; color: #475569;">Team Category</td><td style="padding: 6px 0; color: #0f172a;">' + (data.teamCategory || '') + '</td></tr>' : '') +
            '<tr><td style="padding: 6px 0; font-weight: 600; color: #475569;">Gender Category</td><td style="padding: 6px 0; color: #0f172a;">' + (data.gender || '') + '</td></tr>' +
            '<tr><td style="padding: 6px 0; font-weight: 600; color: #475569;">Mobile Number</td><td style="padding: 6px 0; color: #0f172a;">' + (data.mobile || '') + '</td></tr>' +
            '<tr><td style="padding: 6px 0; font-weight: 600; color: #475569;">City</td><td style="padding: 6px 0; color: #0f172a;">' + (data.city || '') + '</td></tr>' +
          '</table>' +
        '</div>' +
        '<div style="background-color: #f1f5f9; border-radius: 8px; padding: 15px; margin: 24px 0; font-size: 14px; line-height: 1.5;">' +
          'Teams will be finalized through a lucky draw after the registration cut-off date. We will reach out with further details closer to the event.' +
        '</div>' +
        '<p style="font-size: 14px; line-height: 1.6; margin-bottom: 0;">Questions? Reach us at <a href="mailto:registration@osiconkolkata.com" style="color: #002366;">registration@osiconkolkata.com</a>.</p>' +
      '</div>' +
      '<div style="border-top: 1px solid #e2e8f0; padding-top: 20px; text-align: center; color: #64748b; font-size: 13px; line-height: 1.5;">' +
        '<p style="margin: 0; font-weight: 600; color: #475569;">Organizing Committee — OSICON Kolkata 2026</p>' +
        '<p style="margin: 4px 0 0 0;">Osseointegration Society of India</p>' +
      '</div>' +
    '</div>';

  var emailOptions = {
    to: data.email,
    name: EMAIL_FROM_NAME,
    subject: subject,
    body: plainBody,
    htmlBody: htmlBody
  };

  if (EMAIL_FROM && EMAIL_FROM.trim().length > 0) {
    emailOptions.from = EMAIL_FROM.trim();
  }
  if (EMAIL_CC && EMAIL_CC.trim().length > 0) {
    emailOptions.cc = EMAIL_CC.trim();
  }
  if (EMAIL_BCC && EMAIL_BCC.trim().length > 0) {
    emailOptions.bcc = EMAIL_BCC.trim();
  }

  if (EMAIL_FROM && EMAIL_FROM.trim().length > 0) {
    GmailApp.sendEmail(data.email, subject, plainBody, emailOptions);
  } else {
    MailApp.sendEmail(emailOptions);
  }
}