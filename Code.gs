const SHEET_NAME = '기록';
const HEADERS = ['id', 'date', 'category', 'title', 'content', 'memo'];

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) sheet.appendRow(HEADERS);
  return sheet;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    const action = p.action || 'list';
    if (action === 'list') return list_();
    if (action === 'create') return create_(p);
    if (action === 'update') return update_(p);
    if (action === 'delete') return delete_(p);
    return json_({success:false, message:'지원하지 않는 action입니다.'});
  } catch (err) {
    return json_({success:false, message:String(err)});
  }
}

function doPost(e) {
  try {
    const data = JSON.parse((e.postData && e.postData.contents) || '{}');
    switch (data.action) {
      case 'create': return create_(data);
      case 'update': return update_(data);
      case 'delete': return delete_(data);
      case 'list': return list_();
      default: return json_({success:false, message:'지원하지 않는 action입니다.'});
    }
  } catch (err) {
    return json_({success:false, message:String(err)});
  }
}

function list_() {
  const sheet = getSheet_();
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return json_({success:true, data:[]});
  const rows = values.slice(1).filter(r => r.some(v => v !== ''));
  const data = rows.map(r => ({
    id: String(r[0] || ''), date: normalizeDate_(r[1]), category: String(r[2] || ''),
    title: String(r[3] || ''), content: String(r[4] || ''), memo: String(r[5] || '')
  }));
  return json_({success:true, data:data});
}

function create_(d) {
  const sheet = getSheet_();
  sheet.appendRow([d.id || Utilities.getUuid(), d.date || '', d.category || '', d.title || '', d.content || '', d.memo || '']);
  return json_({success:true});
}

function update_(d) {
  const sheet = getSheet_();
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(d.id)) {
      sheet.getRange(i + 1, 1, 1, 6).setValues([[d.id, d.date || '', d.category || '', d.title || '', d.content || '', d.memo || '']]);
      return json_({success:true});
    }
  }
  return json_({success:false, message:'수정할 기록을 찾지 못했습니다.'});
}

function delete_(d) {
  const sheet = getSheet_();
  const values = sheet.getDataRange().getValues();
  for (let i = values.length - 1; i >= 1; i--) {
    if (String(values[i][0]) === String(d.id)) {
      sheet.deleteRow(i + 1);
      return json_({success:true});
    }
  }
  return json_({success:false, message:'삭제할 기록을 찾지 못했습니다.'});
}

function normalizeDate_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const s = String(v || '');
  return s.length >= 10 ? s.slice(0, 10).replace(/\./g, '-') : s;
}
