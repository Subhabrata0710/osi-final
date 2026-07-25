// ============================================================
// EZECON 2026 — Registration Backend
// Google Apps Script — Code.gs
// ============================================================

// --- CONFIGURATION ---
const SHEET_ID = '11g3w5c9WlFiyQNB2mHHxMDTyhvVJ9pQyqp_n_S48J7U';
const UPLOAD_FOLDER_ID = '1mG7hBhJD0O1mdJtJy5fXyP9jyw4SC1-L';

const EMAIL_FROM_NAME = 'EZECON 2026 — SEMI West Bengal';
const EMAIL_CC = 'mukherjeerohit301@gmail.com';  // Add CC emails, comma-separated

// ============================================================
// HANDLE INCOMING REQUESTS
// ============================================================
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) throw new Error('No data received');
    const data = JSON.parse(e.postData.contents);
    let response = {};

    if (data.action === 'register') response = registerUser(data);
    else if (data.action === 'login') response = loginUser(data);
    else if (data.action === 'upload') response = uploadFile(data);
    else if (data.action === 'getFiles') response = getUserFiles(data);
    else if (data.action === 'contact') response = handleContact(data);
    else response = { success: false, message: 'Unknown action: ' + data.action };

    return ContentService.createTextOutput(JSON.stringify(response))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    console.log('Global Error: ' + error.toString());
    // Send failure notification
    sendFailureEmail(error, e ? e.postData.contents : 'No data');
    return ContentService.createTextOutput(JSON.stringify({
      success: false, message: 'Server Error: ' + error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({
    success: true, message: 'EZECON 2026 Registration API is running.'
  })).setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// GET OR CREATE SHEET
// ============================================================
function getSheet(name) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (name === 'Registrations') {
      sheet.appendRow([
        'Serial No', 'Name', 'Email', 'Phone', 'Institution', 'City',
        'Designation', 'Password', 'Delegate Type', 'Food Preference',
        'Gala Dinner', 'Reg Type', 'Amount', 'Payment ID',
        'QR Code URL', 'Timestamp', 'Workshop', 'SIMWARS', 'Team Name', 'Voucher Code'
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
    lock.waitLock(30000);
    const sheet = getSheet('Registrations');
    const allData = sheet.getDataRange().getValues();

    // Duplicate check (email = column C, index 2)
    for (var i = 1; i < allData.length; i++) {
      if (allData[i][2] === data.email) {
        return { success: false, message: 'This email is already registered!' };
      }
    }

    // Serial number
    var rowNum = allData.length;
    var prefix = 'EZ';
    if (data.delegateType === 'PG Resident') prefix = 'EZR';
    var serialNumber = prefix + '-' + (1000 + rowNum);

    // QR Code
    var qrText = 'EZECON 2026\nReg ID: ' + serialNumber + '\nName: ' + (data.name || '') +
      '\nCategory: ' + (data.delegateType || '') + '\nAmount: Rs.' + (data.amount || 0);
    var qrApiUrl = 'https://quickchart.io/qr?text=' + encodeURIComponent(qrText) + '&margin=2&size=300';
    var savedQrUrl = qrApiUrl;
    var globalQrBlob = null;

    try {
      var response = UrlFetchApp.fetch(qrApiUrl);
      globalQrBlob = response.getBlob().getAs(MimeType.PNG).setName('QR_' + serialNumber + '.png');
      var parentFolder = DriveApp.getFolderById(UPLOAD_FOLDER_ID);
      var qrFolders = parentFolder.getFoldersByName('QR');
      var qrFolder = qrFolders.hasNext() ? qrFolders.next() : parentFolder.createFolder('QR');
      var qrFile = qrFolder.createFile(globalQrBlob);
      qrFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      savedQrUrl = qrFile.getUrl();
    } catch (qrErr) {
      console.log('QR save failed: ' + qrErr.toString());
    }

    // Append row
    sheet.appendRow([
      serialNumber,
      data.name || '',
      data.email || '',
      data.phone || '',
      data.institution || '',
      data.city || '',
      data.designation || '',
      data.password || '',
      data.delegateType || '',
      data.foodPreference || '',
      data.hasGala ? 'Yes' : 'No',
      data.regType || '',
      data.amount || 0,
      data.paymentId || '',
      savedQrUrl,
      new Date(),
      data.workshopCategory || '',
      data.simwarsSelected || 'No',
      data.teamName || '',
      data.voucherCode || ''
    ]);

    // Send confirmation email
    try {
      sendConfirmationEmail(data, serialNumber, savedQrUrl, globalQrBlob);
    } catch (emailErr) {
      console.log('Email failed but registration saved: ' + emailErr.toString());
    }

    return {
      success: true,
      message: 'Registration successful! Your ID: ' + serialNumber + '. Confirmation email sent.',
      serialNumber: serialNumber
    };

  } catch (e) {
    console.log('Registration error: ' + e.toString());
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
  var subject = 'Registration Confirmation — EZECON 2026 [' + serialNumber + ']';
  var inlineBlob = null, attachBlob = null, hasQr = false;

  if (qrBlob) {
    try {
      inlineBlob = qrBlob.copyBlob().setName('qrCode.png');
      attachBlob = qrBlob.copyBlob().setName('EZECON_QR_' + serialNumber + '.png');
      hasQr = true;
    } catch (e) { console.log('QR blob copy failed: ' + e.toString()); }
  }

  var plainBody =
    'Dear ' + data.name + ',\n\n' +
    'Thank you for registering for the 5th East Zone Emergency Medicine Conference (EZECON) 2026!\n\n' +
    'Your registration has been confirmed. Details:\n' +
    '─────────────────────────────────\n' +
    'Registration ID : ' + serialNumber + '\n' +
    'Category        : ' + (data.regType || data.delegateType || '') + '\n' +
    'Amount Paid     : ₹' + data.amount + '\n' +
    'Payment ID      : ' + (data.paymentId || 'N/A') + '\n' +
    '─────────────────────────────────\n\n' +
    'QR Code: ' + savedQrUrl + '\n\n' +
    (hasQr ? 'Please present the attached QR code at the venue.\n\n' : '') +
    'Event Details:\n' +
    'Conference : 8–9 August 2026 (Saturday & Sunday)\n' +
    'Venue      : AltAir Boutique Hotel, Sector V, Salt Lake, Kolkata\n' +
    'Website    : www.ezeconsemi.com\n\n' +
    'We look forward to welcoming you!\n\n' +
    'Best regards,\n' +
    'Organizing Committee\n' +
    'EZECON 2026 — SEMI West Bengal Chapter\n' +
    'Email: semiezecon@gmail.com';

  var htmlBody = plainBody.replace(/\n/g, '<br>');
  if (hasQr) {
    htmlBody += '<br><br><b>Your Event QR Code:</b><br>' +
      '<img src="cid:qrCode" alt="Event QR Code" style="width:200px;height:200px;border:1px solid #ccc;"/>' +
      '<br><small>QR code also attached.</small>';
  }

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

  if (EMAIL_CC && EMAIL_CC.length > 0) emailOptions.cc = EMAIL_CC;

  MailApp.sendEmail(emailOptions);
}

// ============================================================
// SEND FAILURE EMAIL
// ============================================================
function sendFailureEmail(error, rawData) {
  try {
    MailApp.sendEmail({
      to: 'semiezecon@gmail.com',
      cc:'mukherjeerohit301@gmail.com',
      name: EMAIL_FROM_NAME,
      subject: '[EZECON 2026] Registration Error Alert',
      body: 'Error: ' + error.toString() + '\n\nRaw Data:\n' + rawData
    });
  } catch (e) { console.log('Failure email also failed: ' + e.toString()); }
}

// ============================================================
// LOGIN
// ============================================================
function loginUser(data) {
  if (!data || !data.email || !data.password) {
    return { success: false, message: 'Email and password are required.' };
  }
  var sheet = getSheet('Registrations');
  var allData = sheet.getDataRange().getValues();

  for (var i = 1; i < allData.length; i++) {
    // Email=col C(2), Password=col H(7)
    if (allData[i][2] === data.email && allData[i][7] === data.password) {
      return {
        success: true,
        serialNumber: allData[i][0],
        name: allData[i][1],
        email: allData[i][2],
        delegateType: allData[i][8],
        regType: allData[i][11],
        amount: allData[i][12],
        qrUrl: allData[i][14]
      };
    }
  }
  return { success: false, message: 'Invalid email or password.' };
}

// ============================================================
// UPLOAD FILE (Abstract submission)
// ============================================================
function uploadFile(data) {
  if (!data || !data.email || !data.fileData) {
    return { success: false, message: 'Email and file data are required.' };
  }
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    var folder = DriveApp.getFolderById(UPLOAD_FOLDER_ID);
    var absFolders = folder.getFoldersByName('Abstracts');
    var absFolder = absFolders.hasNext() ? absFolders.next() : folder.createFolder('Abstracts');

    var fileName = 'Abstract_' + new Date().getTime() + '_' + data.fileName;
    var blob = Utilities.newBlob(Utilities.base64Decode(data.fileData), data.mimeType, fileName);
    var file = absFolder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    // Log to Abstracts sheet
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var absSheet = ss.getSheetByName('Abstracts');
    if (!absSheet) {
      absSheet = ss.insertSheet('Abstracts');
      absSheet.appendRow(['FileID', 'Email', 'FileName', 'FileUrl', 'UploadDate']);
      absSheet.setFrozenRows(1);
    }
    absSheet.appendRow([file.getId(), data.email, data.fileName, file.getUrl(), new Date()]);

    return { success: true, message: 'File uploaded successfully!', fileUrl: file.getUrl() };
  } catch (e) {
    return { success: false, message: 'Upload failed: ' + e.toString() };
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// GET USER FILES
// ============================================================
function getUserFiles(data) {
  if (!data || !data.email) return { success: false, message: 'Email required.' };
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var absSheet = ss.getSheetByName('Abstracts');
    if (!absSheet) return { success: true, files: [] };

    var allData = absSheet.getDataRange().getValues();
    var files = [];
    for (var i = 1; i < allData.length; i++) {
      if (allData[i][1] === data.email) {
        files.push({
          fileId: allData[i][0],
          fileName: allData[i][2],
          fileUrl: allData[i][3],
          uploadDate: Utilities.formatDate(new Date(allData[i][4]), 'Asia/Kolkata', 'dd MMM yyyy, hh:mm a')
        });
      }
    }
    return { success: true, files: files };
  } catch (e) {
    return { success: false, message: 'Could not load files.' };
  }
}

// ============================================================
// CONTACT FORM
// ============================================================
function handleContact(data) {
  if (!data.name || !data.email || !data.message) {
    return { success: false, message: 'Name, email, and message are required.' };
  }
  try {
    MailApp.sendEmail({
      to: 'semiezecon@gmail.com',
      cc:'mukherjeerohit301@gmail.com',
      name: 'EZECON 2026 Website',
      subject: 'Contact Form: ' + (data.subject || 'General Inquiry'),
      body: 'Name: ' + data.name + '\nEmail: ' + data.email + '\nPhone: ' + (data.phone || 'N/A') +
        '\nSubject: ' + (data.subject || 'N/A') + '\n\nMessage:\n' + data.message
    });
    return { success: true, message: 'Message sent successfully!' };
  } catch (e) {
    return { success: false, message: 'Failed to send message.' };
  }
}
