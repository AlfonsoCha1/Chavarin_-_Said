import { mountChrome, cardHtml, $ } from '../app.js';
mountChrome();
// Ejemplos ilustrativos (ficticios) de tres sectores distintos.
$('#fan').innerHTML = [
  cardHtml({ company: 'Música Allegro', program: 'Puntos Allegro', balance: 75, kind: 'points', code: 'C-ALG01', color: '#23395B', rewards: [{ cost: 100 }] }),
  cardHtml({ company: 'Barbería El Filo', program: 'Sellos Filo Centro', balance: 3, kind: 'stamps', code: 'C-FIL01', color: '#2B2D42', rewards: [{ cost: 5 }] }),
  cardHtml({ company: 'Tacos del Centro', program: 'Club Taquero', balance: 40, kind: 'points', code: 'C-104', color: '#8C2F1B', rewards: [{ cost: 50 }] }),
].join('');
