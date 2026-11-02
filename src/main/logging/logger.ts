import winston from 'winston';
import path from 'node:path';
import { app } from 'electron';

// Determine the correct base path for logs
const getAppPath = () => {
  try {
    // When packaged, use the directory containing the executable
    if (app.isPackaged) {
      // In packaged apps, the executable is in a different location than the app.asar
      // We want to use the directory where the executable resides for user data
      const exePath = app.getPath('exe');
      if (exePath) {
        return path.dirname(exePath);
      }
      // Fallback to app.getAppPath() if exePath fails
      return app.getAppPath();
    }

    // When not packaged (development), use the current working directory
    // or the directory of the main script
    try {
      // Try to get the app path first
      const appPath = app.getAppPath();
      if (appPath) {
        return appPath;
      }
    } catch (e) {
      // Ignore errors and continue to fallbacks
    }

    // Fallback to current working directory
    return process.cwd();
  } catch (e) {
    // Final fallback to ensure we always return a valid path
    try {
      return path.resolve('.');
    } catch {
      // Last resort - use system temp directory
      return require('os').tmpdir();
    }
  }
};

const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'development' ? 'debug' : 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, stack }) => {
      return stack
        ? `${timestamp} [${level}] ${message}\n${stack}`
        : `${timestamp} [${level}] ${message}`;
    })
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({
      // Ensure logs directory exists
      filename: path.join(getAppPath(), 'logs', 'automation.log'),
    }),
  ],
});

export default logger;