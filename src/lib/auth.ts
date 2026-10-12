// Email + password login: input checks and Korean messages for Supabase Auth errors.
// Pure (no React Native imports) so it is tested in Node.

export type AuthMode = 'signin' | 'signup';

export const MIN_PASSWORD = 8;

/** Returns a message to show, or null when the form can be sent. */
export function checkCredentials(email: string, password: string, mode: AuthMode, confirm = ''): string | null {
  const e = email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return '이메일 주소를 확인해주세요.';
  if (password.length < MIN_PASSWORD) return `비밀번호는 ${MIN_PASSWORD}자 이상이에요.`;
  if (mode === 'signup' && password !== confirm) return '비밀번호 확인이 달라요.';
  return null;
}

/** Turns a Supabase Auth error into something we can show in the app. */
export function authErrorMessage(err: { message?: string; code?: string; status?: number } | null | undefined): string {
  const code = err?.code ?? '';
  const msg = (err?.message ?? '').toLowerCase();
  if (code === 'invalid_credentials' || msg.includes('invalid login credentials')) return '이메일 또는 비밀번호가 맞지 않아요.';
  if (code === 'user_already_exists' || code === 'email_exists' || msg.includes('already registered')) return '이미 가입된 이메일이에요. 로그인해주세요.';
  if (code === 'signup_disabled' || msg.includes('signups not allowed')) return '새 가입이 막혀 있어요. 이미 만든 계정으로 로그인해주세요.';
  if (code === 'weak_password' || msg.includes('password should be')) return `비밀번호가 너무 약해요. ${MIN_PASSWORD}자 이상으로 정해주세요.`;
  if (code === 'email_not_confirmed' || msg.includes('email not confirmed')) return '이메일 인증이 아직이에요. 잠시 후 다시 시도해주세요.';
  if (code === 'over_request_rate_limit' || err?.status === 429) return '시도가 너무 많아요. 잠시 후 다시 해주세요.';
  if (msg.includes('network') || msg.includes('fetch')) return '인터넷 연결을 확인해주세요.';
  return '로그인하지 못했어요. 잠시 후 다시 시도해주세요.';
}
