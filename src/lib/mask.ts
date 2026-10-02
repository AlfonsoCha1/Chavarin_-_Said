// Enmascarado de datos personales: el personal del negocio ve solo lo necesario para atender.
export function maskName(name?: string | null): string {
  if (!name) return 'Sin nombre';
  return name
    .trim()
    .split(/\s+/)
    .map((w, i) => (i === 0 ? w : w[0] + '.'))
    .join(' ');
}

export function maskEmail(email?: string | null): string | null {
  if (!email) return null;
  const [u, d] = email.split('@');
  return `${u.slice(0, 1)}***@${d}`;
}

export function maskPhone(phone?: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  return `***${digits.slice(-4)}`;
}
