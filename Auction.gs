/****************************************************
 * NBIU Indoor Outdoor Games 2026
 * Football Players Auction System 
  ****************************************************/

const AUCTION_CONFIG = {
  spreadsheetId: '1DvkSht2QfRonwiaGJfbFn6z_5LrhE-Qo7iSZgKPPJUo',
  responseSheetName: 'Registration Data',
  auctionSheetName: 'Auction',
  teamBudgetSheetName: 'Team Budgets',
  footballChoiceHeaders: [
    'Football',
    'Football Choice',
    'Football Participation',
    'Preferred Sport',
    'Selected Sports',
    'Which sports do you want to participate in?'
  ]
};

/****************************************************
 * WEB APP ENTRY
 ****************************************************/
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('NBIU Players Auction')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/****************************************************
 * SETUP
 ****************************************************/
function setupAuctionSystem() {
  const spreadsheet = SpreadsheetApp.openById(AUCTION_CONFIG.spreadsheetId);
  let sheet = spreadsheet.getSheetByName(AUCTION_CONFIG.auctionSheetName);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(AUCTION_CONFIG.auctionSheetName);
  }

  const headers = [
    'Player ID', 'Name', 'Department', 'Batch', 'Student ID',
    'Contact Number', 'Position', 'Player Photo', 'Base Price',
    'Current Bid', 'Bidder Name', 'Auction Status', 'Winner',
    'Final Price', 'Updated At'
  ];

  if (!getHeaders_(sheet)[0]) {
    sheet.getRange(1, 1, 1, headers.length)
      .setValues([headers])
      .setFontWeight('bold');
  }

  sheet.setFrozenRows(1);
  setupTeamBudgetSystem();
  return 'Auction system setup completed.';
}

/****************************************************
 * GET PLAYERS
 ****************************************************/
function getPlayers() {
  const sheet = SpreadsheetApp.openById(AUCTION_CONFIG.spreadsheetId).getSheetByName(AUCTION_CONFIG.responseSheetName);
  if (!sheet) throw new Error('The Registration Data sheet was not found.');
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(String);
  const players = [];
  const seenStudentIds = new Set();

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const name = value_(headers, row, ['Name']);
    if (!name) continue;
    if (!isFootballParticipant_(headers, row)) continue;

    const studentId = value_(headers, row, ['Student ID', 'StudentID']);
    const normalizedId = String(studentId || '').trim().toUpperCase();
    if (!normalizedId) continue;

    if (seenStudentIds.has(normalizedId)) continue;
    seenStudentIds.add(normalizedId);

    players.push({
      playerId: 'PLAYER-' + normalizedId,
      name,
      department: value_(headers, row, ['Department Name', 'Department']),
      batch: value_(headers, row, ['Batch']),
      studentId,
      contactNumber: value_(headers, row, ['Contact Number', 'Contract Number', 'Phone Number']),
      position: value_(headers, row, ['Preferred football position', 'Football Position', 'Player Position', 'Position']) || 'Not specified',
      photo: imageUrl_(value_(headers, row, ['Football player photo (Only for Football)', 'Football player photo', 'Player Photo', 'Photo']))
    });
  }
  return players;
}

function isFootballParticipant_(headers, row) {
  const configuredHeaders = AUCTION_CONFIG.footballChoiceHeaders || [];
  const footballColumns = headers.filter(header => {
    const normalizedHeader = normalize_(header);
    const isConfigured = configuredHeaders.some(item => normalize_(item) === normalizedHeader);
    const isFootballField = normalizedHeader.includes('football')
      && !normalizedHeader.includes('position')
      && !normalizedHeader.includes('photo');
    const isChoiceField = ['choice', 'sport', 'game', 'play', 'participat', 'interest']
      .some(term => normalizedHeader.includes(term));
    return isConfigured || isFootballField || isChoiceField;
  });

  const containsFootball = value => /(^|[^a-z])football([^a-z]|$)/i.test(
    String(value || '').replace(/[\u00a0\u200b]/g, ' ')
  );

  if (footballColumns.length) {
    return footballColumns.some(header => {
      const columnIndex = headers.indexOf(header);
      return containsFootball(row[columnIndex]);
    });
  }

  return row.some(containsFootball);
}

function getAuctionPlayers() {
  const players = getPlayers();
  const sheet = getAuctionSheet_();
  const values = sheet.getLastRow() < 2 ? [] : sheet.getDataRange().getValues();
  const headers = getHeaders_(sheet);
  const auctionData = {};
  for (let i = 1; i < values.length; i++) {
    const id = value_(headers, values[i], ['Player ID']);
    if (id) auctionData[id] = {
      basePrice: value_(headers, values[i], ['Base Price']),
      currentBid: value_(headers, values[i], ['Current Bid']),
      bidderName: value_(headers, values[i], ['Bidder Name']),
      auctionStatus: value_(headers, values[i], ['Auction Status']) || 'Not Started',
      winner: value_(headers, values[i], ['Winner']),
      finalPrice: value_(headers, values[i], ['Final Price'])
    };
  }
  return players.map(player => Object.assign({}, player, auctionData[player.playerId] || {
    basePrice: '', currentBid: '', bidderName: '', auctionStatus: 'Not Started', winner: '', finalPrice: ''
  }));
}

/****************************************************
 * TEAM BUDGET SYSTEM
 ****************************************************/
function setupTeamBudgetSystem() {
  const spreadsheet = SpreadsheetApp.openById(AUCTION_CONFIG.spreadsheetId);
  let sheet = spreadsheet.getSheetByName(AUCTION_CONFIG.teamBudgetSheetName);
  if (!sheet) sheet = spreadsheet.insertSheet(AUCTION_CONFIG.teamBudgetSheetName);
  if (!getHeaders_(sheet)[0]) {
    sheet.getRange(1, 1, 1, 4).setValues([[
      'Team Name', 'Initial Budget', 'Spent', 'Remaining Purse'
    ]]).setFontWeight('bold');
  }
  sheet.setFrozenRows(1);
  return 'Team budget system setup completed.';
}

function setTeamBudget(teamName, initialBudget) {
  const name = String(teamName || '').trim();
  const budget = Number(initialBudget);
  if (!name) throw new Error('Enter a team name.');
  if (budget < 0) throw new Error('Budget cannot be negative.');
  const sheet = getTeamBudgetSheet_();
  const headers = getHeaders_(sheet);
  const row = findTeamRow_(sheet, name);
  if (row) {
    setCell_(sheet, row, headers, 'Initial Budget', budget);
    updateTeamPurse_(sheet, row);
  } else {
    sheet.appendRow([name, budget, 0, budget]);
  }
  return getAuctionSummary();
}

function getAuctionSummary() {
  const sheet = getTeamBudgetSheet_();
  const values = sheet.getLastRow() < 2 ? [] : sheet.getDataRange().getValues();
  const headers = getHeaders_(sheet);
  const teams = values.slice(1).filter(row => value_(headers, row, ['Team Name'])).map(row => ({
    teamName: value_(headers, row, ['Team Name']),
    initialBudget: Number(value_(headers, row, ['Initial Budget']) || 0),
    spent: Number(value_(headers, row, ['Spent']) || 0),
    remainingPurse: Number(value_(headers, row, ['Remaining Purse']) || 0)
  }));
  return { soldPlayers: getSoldPlayers_(), teams };
}

function getAuctionHistoryCsv() {
  const sheet = getAuctionSheet_();
  if (sheet.getLastRow() < 2) {
    return 'Player ID,Name,Department,Batch,Student ID,Position,Winner,Final Price,Auction Status,Updated At\n';
  }

  const values = sheet.getDataRange().getValues();
  const headers = getHeaders_(sheet);
  const outputHeaders = [
    'Player ID', 'Name', 'Department', 'Batch', 'Student ID',
    'Position', 'Winner', 'Final Price', 'Auction Status', 'Updated At'
  ];

  const rows = values.slice(1)
    .filter(row => value_(headers, row, ['Auction Status']) === 'Sold')
    .map(row => outputHeaders.map(header => value_(headers, row, [header])));

  return [outputHeaders, ...rows]
    .map(row => row.map(csvEscape_).join(','))
    .join('\n') + '\n';
}

function csvEscape_(value) {
  const text = value instanceof Date
    ? Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss')
    : String(value ?? '');
  return '"' + text.replace(/"/g, '""') + '"';
}

function getSoldPlayers_() {
  const sheet = getAuctionSheet_();
  if (sheet.getLastRow() < 2) return [];
  const values = sheet.getDataRange().getValues();
  const headers = getHeaders_(sheet);
  return values.slice(1).filter(row => value_(headers, row, ['Auction Status']) === 'Sold').map(row => ({
    playerId: value_(headers, row, ['Player ID']),
    name: value_(headers, row, ['Name']),
    position: value_(headers, row, ['Position']),
    photo: value_(headers, row, ['Player Photo']),
    winner: value_(headers, row, ['Winner']),
    finalPrice: Number(value_(headers, row, ['Final Price']) || 0),
    updatedAt: value_(headers, row, ['Updated At'])
  }));
}

/****************************************************
 * AUCTION ACTIONS (MANUAL BID)
 ****************************************************/

/**
 * Step 1: Save base price
 */
function saveBasePrice(playerId, price) {
  const amount = Number(price);
  if (!amount || amount <= 0) throw new Error('Base price must be greater than zero.');
  const row = ensurePlayer_(playerId);
  const sheet = getAuctionSheet_();
  const headers = getHeaders_(sheet);
  setCell_(sheet, row, headers, 'Base Price', amount);
  setCell_(sheet, row, headers, 'Current Bid', amount);
  setCell_(sheet, row, headers, 'Auction Status', 'Ready');
  setCell_(sheet, row, headers, 'Updated At', new Date());
  return getAuctionPlayers();
}

/**
 * Step 2: Start auction (Ready -> Live)
 */
function startAuction(playerId) {
  const row = ensurePlayer_(playerId);
  const sheet = getAuctionSheet_();
  const headers = getHeaders_(sheet);
  const basePrice = Number(getCell_(sheet, row, headers, 'Base Price'));
  if (!basePrice) throw new Error('Set the base price first.');
  setCell_(sheet, row, headers, 'Current Bid', basePrice);
  setCell_(sheet, row, headers, 'Auction Status', 'Live');
  setCell_(sheet, row, headers, 'Bidder Name', '');
  setCell_(sheet, row, headers, 'Winner', '');
  setCell_(sheet, row, headers, 'Final Price', '');
  setCell_(sheet, row, headers, 'Updated At', new Date());
  return getAuctionPlayers();
}

/**
 * Step 3: MANUAL CLOSE AUCTION
 * After verbal bidding ends - input final price and team name
 */
function closeAuctionManual(playerId, finalPrice, teamName) {
  const price = Number(finalPrice);
  const team = String(teamName || '').trim();

  if (!price || price <= 0) throw new Error('Enter a valid final price.');
  if (!team) throw new Error('Enter the team name.');

  const row = ensurePlayer_(playerId);
  const sheet = getAuctionSheet_();
  const headers = getHeaders_(sheet);

  const status = getCell_(sheet, row, headers, 'Auction Status');
  if (status === 'Sold') throw new Error('This player is already sold.');

  setCell_(sheet, row, headers, 'Current Bid', price);
  setCell_(sheet, row, headers, 'Bidder Name', team);
  setCell_(sheet, row, headers, 'Auction Status', 'Sold');
  setCell_(sheet, row, headers, 'Winner', team);
  setCell_(sheet, row, headers, 'Final Price', price);
  setCell_(sheet, row, headers, 'Updated At', new Date());

  addTeamSpending_(team, price);

  return {
    players: getAuctionPlayers(),
    summary: getAuctionSummary()
  };
}

/**
 * Reset auction - Return sold player back to auction pool
 */
function resetAuction(playerId) {
  const row = ensurePlayer_(playerId);
  const sheet = getAuctionSheet_();
  const headers = getHeaders_(sheet);
  const previousStatus = getCell_(sheet, row, headers, 'Auction Status');
  const previousWinner = getCell_(sheet, row, headers, 'Winner');
  const previousFinalPrice = Number(getCell_(sheet, row, headers, 'Final Price') || 0);
  if (previousStatus === 'Sold' && previousWinner && previousFinalPrice) {
    removeTeamSpending_(String(previousWinner).trim(), previousFinalPrice);
  }
  const basePrice = getCell_(sheet, row, headers, 'Base Price');
  setCell_(sheet, row, headers, 'Current Bid', basePrice);
  setCell_(sheet, row, headers, 'Bidder Name', '');
  setCell_(sheet, row, headers, 'Auction Status', basePrice ? 'Ready' : 'Not Started');
  setCell_(sheet, row, headers, 'Winner', '');
  setCell_(sheet, row, headers, 'Final Price', '');
  setCell_(sheet, row, headers, 'Updated At', new Date());
  return {
    players: getAuctionPlayers(),
    summary: getAuctionSummary()
  };
}

/**
 * Return sold player to auction pool (explicit alias)
 */
function returnPlayerToAuction(playerId) {
  return resetAuction(playerId);
}

/****************************************************
 * SHEET HELPERS
 ****************************************************/
function getAuctionSheet_() {
  const spreadsheet = SpreadsheetApp.openById(AUCTION_CONFIG.spreadsheetId);
  let sheet = spreadsheet.getSheetByName(AUCTION_CONFIG.auctionSheetName);
  if (!sheet) sheet = spreadsheet.insertSheet(AUCTION_CONFIG.auctionSheetName);
  return sheet;
}

function getTeamBudgetSheet_() {
  const spreadsheet = SpreadsheetApp.openById(AUCTION_CONFIG.spreadsheetId);
  let sheet = spreadsheet.getSheetByName(AUCTION_CONFIG.teamBudgetSheetName);
  if (!sheet) sheet = spreadsheet.insertSheet(AUCTION_CONFIG.teamBudgetSheetName);
  if (!getHeaders_(sheet)[0]) setupTeamBudgetSystem();
  return sheet;
}

function findTeamRow_(sheet, teamName) {
  if (sheet.getLastRow() < 2) return 0;
  const headers = getHeaders_(sheet);
  const teamColumn = headers.indexOf('Team Name') + 1;
  const values = sheet.getRange(2, teamColumn, sheet.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0]).trim().toLowerCase() === teamName.toLowerCase()) return i + 2;
  }
  return 0;
}

function addTeamSpending_(teamName, amount) {
  const sheet = getTeamBudgetSheet_();
  const headers = getHeaders_(sheet);
  let row = findTeamRow_(sheet, teamName);
  if (!row) {
    sheet.appendRow([teamName, 0, 0, 0]);
    row = sheet.getLastRow();
  }
  const spent = Number(getCell_(sheet, row, headers, 'Spent') || 0) + amount;
  setCell_(sheet, row, headers, 'Spent', spent);
  updateTeamPurse_(sheet, row);
}

function removeTeamSpending_(teamName, amount) {
  const sheet = getTeamBudgetSheet_();
  const row = findTeamRow_(sheet, teamName);
  if (!row) return;
  const headers = getHeaders_(sheet);
  const spent = Math.max(0, Number(getCell_(sheet, row, headers, 'Spent') || 0) - amount);
  setCell_(sheet, row, headers, 'Spent', spent);
  updateTeamPurse_(sheet, row);
}

function updateTeamPurse_(sheet, row) {
  const headers = getHeaders_(sheet);
  const budget = Number(getCell_(sheet, row, headers, 'Initial Budget') || 0);
  const spent = Number(getCell_(sheet, row, headers, 'Spent') || 0);
  setCell_(sheet, row, headers, 'Remaining Purse', budget - spent);
}

function getHeaders_(sheet) {
  return sheet.getLastColumn() ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(value => String(value || '').trim()) : [];
}

function ensurePlayer_(playerId) {
  const sheet = getAuctionSheet_();
  const headers = getHeaders_(sheet);
  const idColumn = headers.indexOf('Player ID') + 1;
  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const ids = sheet.getRange(2, idColumn, lastRow - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(playerId)) return i + 2;
  }
  const player = getPlayers().find(item => item.playerId === playerId);
  if (!player) throw new Error('Player was not found.');
  sheet.appendRow([player.playerId, player.name, player.department, player.batch, player.studentId, player.contactNumber, player.position, player.photo, '', '', '', 'Not Started', '', '', new Date()]);
  return sheet.getLastRow();
}

function getCell_(sheet, row, headers, name) {
  const column = headers.indexOf(name);
  return column < 0 ? '' : sheet.getRange(row, column + 1).getValue();
}

function setCell_(sheet, row, headers, name, value) {
  const column = headers.indexOf(name);
  if (column < 0) throw new Error('Header was not found: ' + name);
  sheet.getRange(row, column + 1).setValue(value);
}

function value_(headers, row, names) {
  for (const name of names) {
    const wanted = normalize_(name);
    for (let i = 0; i < headers.length; i++) if (normalize_(headers[i]) === wanted) return String(row[i] ?? '').trim();
  }
  return '';
}

function normalize_(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

function imageUrl_(url) {
  url = String(url || '').trim();
  const match = url.match(/[-\w]{25,}/);
  return url.includes('drive.google.com') && match ? 'https://drive.google.com/thumbnail?id=' + match[0] + '&sz=w800' : url;
}