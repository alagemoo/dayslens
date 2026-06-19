// skip-sign.js — no-op signing hook for electron-builder
// Replaces the broken "sign": false config that electron-builder 24.x ignores
exports.default = async function() { /* no signing */ };