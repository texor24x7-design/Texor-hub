/**
 * Pure modules shared with the frontend.
 *
 * They live under frontend/src/lib/shared because Next cannot import from
 * outside its own directory without extra configuration, while Node can import
 * from anywhere. One copy, so the browser's preview and the server's numbers are
 * computed by the same code.
 */
export * as india from '../../frontend/src/lib/shared/india.mjs';
export * as money from '../../frontend/src/lib/shared/money.mjs';
