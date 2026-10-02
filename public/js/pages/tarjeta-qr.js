import { mountChrome, $ } from '../app.js';
mountChrome();
$('#code').textContent = decodeURIComponent(location.pathname.split('/').pop() || '');
