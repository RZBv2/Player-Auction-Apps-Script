/****************************************************
 * NBIU Indoor Outdoor Games 2026
 * Automatic Meal Token Generator
  ****************************************************/

const CONFIG = {
  spreadsheetId: '1DvkSht2QfRonwiaGJfbFn6z_5LrhE-Qo7iSZgKPPJUo',
  responseSheetName: 'Registration Data',
  tokenSheetName: 'Token',
  printSheetName: 'Printable Token',

  organizationName: 'Computer Society, NBIU',
  departmentName: 'Department of Computer Science and Engineering',
  eventDate: '04 October 2026',
  tokenPrefix: 'MEAL-20261004-',
  timezone: 'Asia/Dhaka',

  requireTransactionId: false,
  sendEmail: false,

  paymentStatusPending: 'Pending',
  paymentStatusPaid: 'Paid',
  mealStatusGenerated: 'Not Collected',   
  mealStatusCollected: 'Collected'
};

/****************************************************
 * SETUP (run once)
 ****************************************************/
function setupMealTokenAutomation() {
  const spreadsheet = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const responseSheet = spreadsheet.getSheetByName(CONFIG.responseSheetName);
  const tokenSheet = spreadsheet.getSheetByName(CONFIG.tokenSheetName);

  if (!responseSheet) throw new Error('Response sheet not found: ' + CONFIG.responseSheetName);
  if (!tokenSheet) throw new Error('Token sheet not found: ' + CONFIG.tokenSheetName);

  ensureTokenHeaders_(tokenSheet);
  syncTokensWithResponses();
  generateMissingTokens();
  forceRebuildPrintableTokens();

  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === 'handleFormSubmit') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger('handleFormSubmit')
    .forSpreadsheet(spreadsheet)
    .onFormSubmit()
    .create();

  Logger.log('Meal token automation configured successfully.');
}

/****************************************************
 * MAIN AUTOMATION - Trigger on form submit
 ****************************************************/
function handleFormSubmit(e) {
  if (!e || !e.namedValues) {
    throw new Error('This function must run from a spreadsheet form-submit trigger.');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const spreadsheet = SpreadsheetApp.openById(CONFIG.spreadsheetId);
    const tokenSheet = spreadsheet.getSheetByName(CONFIG.tokenSheetName);
    if (!tokenSheet) throw new Error('Token sheet not found.');

    ensureTokenHeaders_(tokenSheet);

    const participant = {
      name: getFormValue_(e.namedValues, ['Name']),
      department: getFormValue_(e.namedValues, ['Department Name', 'Department']),
      batch: getFormValue_(e.namedValues, ['Batch']),
      studentId: getFormValue_(e.namedValues, ['Student ID', 'StudentID']),
      transactionId: getFormValue_(e.namedValues, ['Transaction ID', 'TransactionID']),
      email: getFormValue_(e.namedValues, ['Email Address', 'Email', 'Email address'])
    };

    if (!participant.studentId) {
      writeLog_(tokenSheet, 'REJECTED: Student ID missing.');
      return;
    }

    const normalizedId = normalizeStudentId_(participant.studentId);

    if (!isStudentInResponseSheet_(normalizedId)) {
      writeLog_(tokenSheet, 'REJECTED: Student ID not found in Registration Data -> ' + participant.studentId);
      return;
    }

    if (isDuplicateStudent_(tokenSheet, normalizedId)) {
      writeLog_(tokenSheet, 'REJECTED: Duplicate Student ID -> ' + participant.studentId);
      return;
    }

    if (CONFIG.requireTransactionId && !participant.transactionId) {
      writeLog_(tokenSheet, 'REJECTED: Transaction ID missing -> ' + participant.studentId);
      return;
    }

    const tokenNo = generateNextToken_(tokenSheet);

    const paymentStatus = participant.transactionId
      ? CONFIG.paymentStatusPaid
      : CONFIG.paymentStatusPending;

    appendTokenRow_(tokenSheet, {
      tokenNo,
      participantId: 'P-' + String(participant.studentId).trim(),
      name: participant.name,
      studentId: participant.studentId,
      department: participant.department,
      batch: participant.batch,
      paymentStatus: paymentStatus,
      mealStatus: CONFIG.mealStatusGenerated,
      collectedAt: '',
      notes: participant.transactionId
        ? 'Transaction ID: ' + participant.transactionId
        : 'Transaction ID missing'
    });

    forceRebuildPrintableTokens();

    if (CONFIG.sendEmail && participant.email) {
      sendTokenEmail_(participant.email, participant.name, tokenNo, participant.studentId);
    }
  } finally {
    lock.releaseLock();
  }
}

/****************************************************
 *  CLEAN & REBUILD ALL TOKENS FROM SCRATCH
 ****************************************************/
function cleanAndRebuildAllTokens() {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const tokenSheet = ss.getSheetByName(CONFIG.tokenSheetName);
  const responseSheet = ss.getSheetByName(CONFIG.responseSheetName);

  if (!tokenSheet) throw new Error('Token sheet missing!');
  if (!responseSheet) throw new Error('Registration Data sheet missing!');

  Logger.log('=== STEP 1: Cleaning Token sheet ===');
  Logger.log('Before - Last Row: ' + tokenSheet.getLastRow());

  const lastRow = tokenSheet.getLastRow();
  if (lastRow > 1) {
    tokenSheet.deleteRows(2, lastRow - 1);
  }

  Logger.log('After delete - Last Row: ' + tokenSheet.getLastRow());

  const headers = [
    'Token No', 'Participant ID', 'Name', 'Student ID', 'Department',
    'Batch', 'Payment Status', 'Meal Status', 'Collected At', 'Notes'
  ];
  tokenSheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');

  Logger.log('=== STEP 2: Reading Registration Data ===');
  const respValues = responseSheet.getDataRange().getValues();
  const respHeaders = respValues[0].map(String);

  const nameIdx = respHeaders.findIndex(h => h.trim().toLowerCase() === 'name');
  const deptIdx = respHeaders.findIndex(h => h.trim().toLowerCase() === 'department name');
  const batchIdx = respHeaders.findIndex(h => h.trim().toLowerCase() === 'batch');
  const idIdx = respHeaders.findIndex(h => h.trim().toLowerCase() === 'student id');

  Logger.log('Column indexes -> Name: ' + nameIdx + ', Dept: ' + deptIdx + ', Batch: ' + batchIdx + ', Student ID: ' + idIdx);

  if ([nameIdx, deptIdx, batchIdx, idIdx].some(i => i < 0)) {
    Logger.log('Required headers missing! Found: ' + respHeaders.join(' | '));
    return;
  }

  Logger.log('=== STEP 3: Generating tokens ===');
  const seenIds = new Set();
  let generated = 0;
  let skipped = 0;
  const rowsToAppend = [];

  for (let i = 1; i < respValues.length; i++) {
    const row = respValues[i];
    const name = String(row[nameIdx] || '').trim();
    const studentId = String(row[idIdx] || '').trim();

    if (!name || !studentId) { skipped++; continue; }

    const normalizedId = studentId.toUpperCase();
    if (seenIds.has(normalizedId)) { skipped++; continue; }
    seenIds.add(normalizedId);

    const tokenNo = CONFIG.tokenPrefix + String(generated + 1).padStart(4, '0');

    rowsToAppend.push([
      tokenNo,
      'P-' + studentId,
      name,
      studentId,
      String(row[deptIdx] || '').trim(),
      String(row[batchIdx] || '').trim(),
      CONFIG.paymentStatusPending,
      CONFIG.mealStatusGenerated,
      '',
      'Auto generated from Registration Data'
    ]);

    generated++;
  }

  Logger.log('Generated: ' + generated + ', Skipped: ' + skipped);

  if (rowsToAppend.length > 0) {
    tokenSheet.getRange(2, 1, rowsToAppend.length, headers.length).setValues(rowsToAppend);
    Logger.log('Inserted ' + rowsToAppend.length + ' rows into Token sheet.');
  }

  Logger.log('=== STEP 4: Rebuilding Printable Token ===');
  forceRebuildPrintableTokens();

  Logger.log('=== DONE ===');
  Logger.log('Token sheet final row count: ' + tokenSheet.getLastRow());
  Logger.log('Printable Token rebuild complete.');
}

/****************************************************
 * BACKFILL - Existing Registration Data rows
 ****************************************************/
function generateMissingTokens() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const spreadsheet = SpreadsheetApp.openById(CONFIG.spreadsheetId);
    const responseSheet = spreadsheet.getSheetByName(CONFIG.responseSheetName);
    const tokenSheet = spreadsheet.getSheetByName(CONFIG.tokenSheetName);
    if (!responseSheet) throw new Error('Response sheet not found: ' + CONFIG.responseSheetName);
    if (!tokenSheet) throw new Error('Token sheet not found: ' + CONFIG.tokenSheetName);

    ensureTokenHeaders_(tokenSheet);
    if (responseSheet.getLastRow() < 2) {
      Logger.log('No response rows found.');
      return;
    }

    const responseValues = responseSheet.getDataRange().getValues();
    const headers = responseValues[0].map(value => String(value || '').trim());
    const findHeader = names => {
      const wanted = names.map(normalize_);
      return headers.findIndex(header => wanted.includes(normalize_(header)));
    };

    const nameIndex = findHeader(['Name']);
    const departmentIndex = findHeader(['Department Name']);
    const batchIndex = findHeader(['Batch']);
    const studentIdIndex = findHeader(['Student ID', 'StudentID']);

    if ([nameIndex, departmentIndex, batchIndex, studentIdIndex].some(index => index < 0)) {
      Logger.log('Required headers not found. Found: ' + headers.join(' | '));
      return;
    }

    const tokenHeaders = tokenSheet.getRange(1, 1, 1, tokenSheet.getLastColumn()).getValues()[0].map(String);
    const tokenStudentIndex = tokenHeaders.findIndex(header => normalize_(header) === normalize_('Student ID'));
    const existingIds = new Set();
    if (tokenStudentIndex >= 0 && tokenSheet.getLastRow() >= 2) {
      tokenSheet.getRange(2, tokenStudentIndex + 1, tokenSheet.getLastRow() - 1, 1).getValues()
        .forEach(row => { const id = normalizeStudentId_(row[0]); if (id) existingIds.add(id); });
    }

    let generated = 0;
    let skipped = 0;
    const seenInThisRun = new Set();

    responseValues.slice(1).forEach(row => {
      const studentId = String(row[studentIdIndex] || '').trim();
      const normalizedId = normalizeStudentId_(studentId);

      if (!normalizedId) { skipped++; return; }
      if (existingIds.has(normalizedId)) { skipped++; return; }
      if (seenInThisRun.has(normalizedId)) { skipped++; return; }

      seenInThisRun.add(normalizedId);

      const tokenNo = generateNextToken_(tokenSheet);
      appendTokenRow_(tokenSheet, {
        tokenNo,
        participantId: 'P-' + studentId,
        name: row[nameIndex],
        studentId,
        department: row[departmentIndex],
        batch: row[batchIndex],
        paymentStatus: CONFIG.paymentStatusPending,
        mealStatus: CONFIG.mealStatusGenerated,
        collectedAt: '',
        notes: 'Generated from Registration Data'
      });
      existingIds.add(normalizedId);
      generated++;
    });

    Logger.log('Generated: ' + generated + ', Skipped: ' + skipped);
  } finally {
    lock.releaseLock();
  }
}

/****************************************************
 * SYNC - Deleted rows remove from Token sheet
 ****************************************************/
function syncTokensWithResponses() {
  const spreadsheet = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const tokenSheet = spreadsheet.getSheetByName(CONFIG.tokenSheetName);
  if (!tokenSheet) throw new Error('Token sheet not found.');

  ensureTokenHeaders_(tokenSheet);
  const validStudentIds = getResponseStudentIds_();
  const headers = tokenSheet.getRange(1, 1, 1, tokenSheet.getLastColumn()).getValues()[0].map(String);
  const tokenIndex = headers.findIndex(header => normalize_(header) === normalize_('Token No'));
  const studentIndex = headers.findIndex(header => normalize_(header) === normalize_('Student ID'));
  if (tokenIndex < 0 || studentIndex < 0 || tokenSheet.getLastRow() < 2) return;

  const rows = tokenSheet.getRange(2, 1, tokenSheet.getLastRow() - 1, tokenSheet.getLastColumn()).getValues();
  const seen = new Set();
  const rowsToDelete = [];

  rows.forEach((row, offset) => {
    const token = String(row[tokenIndex] || '').trim();
    const studentId = normalizeStudentId_(row[studentIndex]);
    if (!token) return;

    if (!studentId || !validStudentIds.has(studentId) || seen.has(studentId)) {
      rowsToDelete.push(offset + 2);
    } else {
      seen.add(studentId);
    }
  });

  rowsToDelete.reverse().forEach(rowNumber => tokenSheet.deleteRow(rowNumber));
  Logger.log(rowsToDelete.length + ' invalid token row(s) removed.');
}

/****************************************************
 * HELPERS
 ****************************************************/
function isStudentInResponseSheet_(studentId) {
  return getResponseStudentIds_().has(normalizeStudentId_(studentId));
}

function getResponseStudentIds_() {
  const spreadsheet = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = spreadsheet.getSheetByName(CONFIG.responseSheetName);
  if (!sheet || sheet.getLastRow() < 2) return new Set();
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(String);

  let studentIndex = headers.findIndex(header =>
    ['studentid', 'studentnumber', 'id', 'studentidnumber'].includes(normalize_(header))
  );

  if (studentIndex < 0) {
    studentIndex = headers.findIndex(header => {
      const h = normalize_(header);
      return h.includes('student') && h.includes('id');
    });
  }

  if (studentIndex < 0) {
    Logger.log('Student ID column not found. Headers: ' + headers.join(' | '));
    return new Set();
  }

  return new Set(values.slice(1).map(row => normalizeStudentId_(row[studentIndex])).filter(Boolean));
}

function normalizeStudentId_(value) {
  return String(value || '').trim().toUpperCase();
}

function isDuplicateStudent_(sheet, normalizedStudentId) {
  if (sheet.getLastRow() < 2) return false;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const index = headers.findIndex(header => normalize_(header) === normalize_('Student ID'));
  if (index < 0) return false;
  const search = normalizeStudentId_(normalizedStudentId);
  return sheet.getRange(2, index + 1, sheet.getLastRow() - 1, 1).getValues()
    .some(row => normalizeStudentId_(row[0]) === search);
}

function generateNextToken_(sheet) {
  if (sheet.getLastRow() < 2) return CONFIG.tokenPrefix + '0001';
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const index = headers.findIndex(header => normalize_(header) === normalize_('Token No'));
  if (index < 0) return CONFIG.tokenPrefix + '0001';
  let maximum = 0;
  sheet.getRange(2, index + 1, sheet.getLastRow() - 1, 1).getValues().forEach(row => {
    const token = String(row[0] || '');
    const match = token.match(/^MEAL-[^-]+-(\d+)$/i);
    if (match) maximum = Math.max(maximum, Number(match[1]));
  });
  return CONFIG.tokenPrefix + String(maximum + 1).padStart(4, '0');
}

function ensureTokenHeaders_(sheet) {
  const required = [
    'Token No', 'Participant ID', 'Name', 'Student ID', 'Department',
    'Batch', 'Payment Status', 'Meal Status', 'Collected At', 'Notes'
  ];
  const current = sheet.getLastColumn() > 0
    ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String)
    : [];
  const headers = current.filter((header, index) => index === 0 || header.trim() !== '');
  required.forEach(header => {
    if (!headers.some(existing => normalize_(existing) === normalize_(header))) headers.push(header);
  });
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
}

function appendTokenRow_(sheet, data) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const values = {
    'Token No': data.tokenNo,
    'Participant ID': data.participantId,
    'Name': data.name,
    'Student ID': data.studentId,
    'Department': data.department,
    'Batch': data.batch,
    'Payment Status': data.paymentStatus,
    'Meal Status': data.mealStatus,
    'Collected At': data.collectedAt,
    'Notes': data.notes
  };
  sheet.appendRow(headers.map(header => values[header] ?? ''));
}

function getFormValue_(namedValues, possibleNames) {
  const keys = Object.keys(namedValues || {});
  for (const wantedName of possibleNames) {
    const wanted = normalize_(wantedName);
    const actualKey = keys.find(key => normalize_(key) === wanted);
    if (actualKey) {
      const value = namedValues[actualKey];
      return String(Array.isArray(value) ? value[0] || '' : value || '').trim();
    }
  }
  return '';
}

function getSheetValue_(headers, row, wantedHeader) {
  const wanted = normalize_(wantedHeader);
  const index = headers.findIndex(header => normalize_(header) === wanted);
  return index < 0 ? '' : row[index];
}

function getLastFourDigits_(studentId) {
  const value = String(studentId || '').trim();
  const digits = value.replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : (digits || value.slice(-4));
}

function writeLog_(sheet, message) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const row = new Array(headers.length).fill('');
  const notesIndex = headers.findIndex(header => normalize_(header) === normalize_('Notes'));
  if (notesIndex >= 0) row[notesIndex] = message;
  sheet.appendRow(row);
}

function normalize_(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/****************************************************
 *  FORCE REBUILD PRINTABLE TOKEN
 ****************************************************/
function forceRebuildPrintableTokens() {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const tokenSheet = ss.getSheetByName(CONFIG.tokenSheetName);
  let printSheet = ss.getSheetByName(CONFIG.printSheetName);

  if (!tokenSheet) {
    Logger.log('Token sheet missing!');
    return;
  }

  Logger.log('Token sheet rows: ' + tokenSheet.getLastRow());

  if (tokenSheet.getLastRow() < 2) {
    Logger.log('Token sheet e kono data nei!');
    return;
  }

  if (!printSheet) {
    printSheet = ss.insertSheet(CONFIG.printSheetName);
    Logger.log('Printable Token sheet created.');
  }

  const lastRow = tokenSheet.getLastRow();
  const lastColumn = tokenSheet.getLastColumn();
  const values = tokenSheet.getRange(1, 1, lastRow, lastColumn).getValues();
  const headers = values[0].map(String);
  const tokenIndex = headers.findIndex(h => String(h).trim().toLowerCase() === 'token no');

  if (tokenIndex < 0) {
    Logger.log('Token No column not found! Headers: ' + headers.join(' | '));
    return;
  }

  const tokenRows = values.slice(1).filter(row =>
    String(row[tokenIndex] || '').trim() !== ''
  );

  Logger.log('Valid token rows: ' + tokenRows.length);

  if (tokenRows.length === 0) {
    Logger.log('No valid token rows found!');
    return;
  }

  printSheet.getDataRange().breakApart();
  printSheet.clear();
  printSheet.setHiddenGridlines(true);

  const tokensPerRow = 3;
  const layoutColumns = 5;
  const cardRows = 8;
  const rowGap = 1;

  for (let col = 1; col <= layoutColumns; col++) {
    printSheet.setColumnWidth(col, col % 2 ? 250 : 24);
  }

  const cardRowCount = Math.ceil(tokenRows.length / tokensPerRow);
  const totalRows = Math.max(cardRows, cardRowCount * cardRows + Math.max(0, cardRowCount - 1) * rowGap);

  for (let row = 1; row <= totalRows; row++) {
    const isGapRow = row > 1 && ((row - 1) % (cardRows + rowGap) === cardRows);
    printSheet.setRowHeight(row, isGapRow ? 16 : 22);
  }

  for (let index = 0; index < tokenRows.length; index++) {
    const row = tokenRows[index];
    const cardColumn = (index % tokensPerRow) * 2 + 1;
    const cardRow = Math.floor(index / tokensPerRow) * (cardRows + rowGap) + 1;

    const getVal = (name) => {
      const i = headers.findIndex(h => String(h).trim().toLowerCase() === name.toLowerCase());
      return i < 0 ? '' : row[i];
    };

    const studentId = String(getVal('Student ID') || '');
    const digits = studentId.replace(/\D/g, '');
    const last4 = digits.length >= 4 ? digits.slice(-4) : studentId.slice(-4);

    const cardValues = [
      [CONFIG.organizationName],
      [CONFIG.departmentName],
      ['Date: ' + CONFIG.eventDate],
      ['Token: ' + getVal('Token No')],
      ['Name: ' + getVal('Name')],
      ['Department: ' + getVal('Department')],
      ['Batch: ' + getVal('Batch')],
      ['ID: ' + last4]
    ];

    const cardRange = printSheet.getRange(cardRow, cardColumn, cardRows, 1);
    cardRange.setValues(cardValues)
      .setFontFamily('Arial')
      .setFontSize(9)
      .setWrap(true)
      .setVerticalAlignment('middle')
      .setBorder(true, true, true, true, true, true, '#1f2937', SpreadsheetApp.BorderStyle.SOLID);

    printSheet.getRange(cardRow, cardColumn).setFontSize(13).setFontWeight('bold').setHorizontalAlignment('center');
    printSheet.getRange(cardRow + 1, cardColumn).setFontSize(8).setFontWeight('bold').setHorizontalAlignment('center');
    printSheet.getRange(cardRow + 2, cardColumn).setFontSize(9).setHorizontalAlignment('center');
    printSheet.getRange(cardRow + 3, cardColumn).setFontSize(11).setFontWeight('bold').setBackground('#fff2cc');
    printSheet.getRange(cardRow + 4, cardColumn, 4, 1).setHorizontalAlignment('left');

    printSheet.setRowHeight(cardRow, 26);
    printSheet.setRowHeight(cardRow + 1, 20);
    printSheet.setRowHeight(cardRow + 2, 20);
    printSheet.setRowHeight(cardRow + 3, 28);
  }

  Logger.log('Printable Token rebuilt: ' + tokenRows.length + ' cards');
}

/****************************************************
 * DIAGNOSTIC - run to debug
 ****************************************************/
function diagnosePrintableToken() {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const responseSheet = ss.getSheetByName(CONFIG.responseSheetName);
  const tokenSheet = ss.getSheetByName(CONFIG.tokenSheetName);
  const printSheet = ss.getSheetByName(CONFIG.printSheetName);

  Logger.log('=== SHEETS ===');
  Logger.log('Registration Data: ' + (responseSheet ? 'FOUND' : 'MISSING'));
  Logger.log('Token: ' + (tokenSheet ? 'FOUND' : 'MISSING'));
  Logger.log('Printable Token: ' + (printSheet ? 'FOUND' : 'MISSING'));

  if (!tokenSheet) { Logger.log('Token sheet missing!'); return; }

  Logger.log('=== TOKEN SHEET ===');
  Logger.log('Last Row: ' + tokenSheet.getLastRow());
  Logger.log('Last Col: ' + tokenSheet.getLastColumn());
  const tokenHeaders = tokenSheet.getLastColumn() > 0
    ? tokenSheet.getRange(1, 1, 1, tokenSheet.getLastColumn()).getValues()[0]
    : [];
  Logger.log('Headers: ' + JSON.stringify(tokenHeaders));

  if (tokenSheet.getLastRow() >= 2) {
    const tokenData = tokenSheet.getRange(2, 1, Math.min(5, tokenSheet.getLastRow() - 1), tokenSheet.getLastColumn()).getValues();
    Logger.log('First 5 rows: ' + JSON.stringify(tokenData));
  } else {
    Logger.log('Token sheet e kono data row nei!');
  }

  if (responseSheet) {
    Logger.log('=== REGISTRATION DATA ===');
    Logger.log('Last Row: ' + responseSheet.getLastRow());
    const respHeaders = responseSheet.getRange(1, 1, 1, responseSheet.getLastColumn()).getValues()[0];
    Logger.log('Headers: ' + JSON.stringify(respHeaders));
  }
}

/****************************************************
 * EMAIL (optional)
 ****************************************************/
function sendTokenEmail_(email, name, tokenNo, studentId) {
  const body = [
    'Dear ' + (name || 'Participant') + ',',
    '',
    'Your meal token has been generated successfully.',
    '',
    CONFIG.organizationName,
    CONFIG.departmentName,
    'Date: ' + CONFIG.eventDate,
    '',
    'Token: ' + tokenNo,
    'Name: ' + name,
    'Student ID: ' + studentId,
    '',
    'Regards,',
    CONFIG.organizationName
  ].join('\n');
  MailApp.sendEmail(email, 'NBIU Meal Token - ' + CONFIG.eventDate, body);
}