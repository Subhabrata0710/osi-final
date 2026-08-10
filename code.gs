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

function doGet(e) {
  try {
    var action = e && e.parameter && e.parameter.action;

    // --- Invoice Download Page support ---
    if (action === 'lookup') {
      return handleInvoiceLookup(e.parameter);
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
        'City'
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
      data.city || ''
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