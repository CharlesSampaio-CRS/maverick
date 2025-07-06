async function status() {
  return { success: true, action: 'status' };
}
async function toggle() {
  return { success: true, action: 'toggle' };
}
async function run() {
  return { success: true, action: 'run' };
}
async function config(body) {
  return { success: true, action: 'config', body };
}
async function addSymbol(body) {
  return { success: true, action: 'addSymbol', body };
}
async function removeSymbol(symbol) {
  return { success: true, action: 'removeSymbol', symbol };
}
async function updateSymbol(symbol, body) {
  return { success: true, action: 'updateSymbol', symbol, body };
}
async function getSymbol(symbol) {
  return { success: true, action: 'getSymbol', symbol };
}
async function statusDetailed() {
  return { success: true, action: 'statusDetailed' };
}

module.exports = {
  status,
  toggle,
  run,
  config,
  addSymbol,
  removeSymbol,
  updateSymbol,
  getSymbol,
  statusDetailed
}; 