window.ITLIB_CONFIG = window.ITLIB_CONFIG || {};

if (["localhost", "127.0.0.1"].includes(window.location.hostname)) {
  window.ITLIB_CONFIG.API_BASE = "";
} else {
  window.ITLIB_CONFIG.API_BASE = "https://projectmek-pup.onrender.com";
}