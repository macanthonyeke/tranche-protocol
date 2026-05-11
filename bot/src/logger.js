// Tiny structured logger. Avoid pulling a heavy logging dep for a small bot.
function fmt(level, msg, meta) {
  const ts = new Date().toISOString();
  if (meta && Object.keys(meta).length > 0) {
    return `[${ts}] [${level}] ${msg} ${JSON.stringify(meta)}`;
  }
  return `[${ts}] [${level}] ${msg}`;
}

export const logger = {
  info(msg, meta) {
    console.log(fmt('INFO', msg, meta));
  },
  warn(msg, meta) {
    console.warn(fmt('WARN', msg, meta));
  },
  error(msg, meta) {
    console.error(fmt('ERROR', msg, meta));
  },
  debug(msg, meta) {
    if (process.env.DEBUG) console.log(fmt('DEBUG', msg, meta));
  },
};
