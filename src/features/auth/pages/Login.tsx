import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Lock, Mail } from 'lucide-react';
import {
  GlassCard,
  Logo,
  PrimaryButton,
  Field,
  inputClass,
  RuntimeModeIndicator,
  AsyncErrorAlert,
} from '../../../shared/components';
import { ROUTES } from '../../../constants';
import { useAuthSession } from '../../../auth/authSessionContext';

export function Login() {
  const navigate = useNavigate();
  const { error, signIn, status } = useAuthSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [signInError, setSignInError] = useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);

  useEffect(() => {
    if (status === 'authorized' || status === 'mock') {
      navigate(ROUTES.dashboard, { replace: true });
    }
  }, [navigate, status]);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (isSigningIn) return;
    setSignInError(null);
    setIsSigningIn(true);
    try {
      await signIn(email.trim(), password);
    } catch {
      setSignInError('เข้าสู่ระบบไม่ได้ กรุณาตรวจสอบอีเมลและรหัสผ่าน');
    } finally {
      setIsSigningIn(false);
    }
  };

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="relative flex min-h-screen items-center justify-center overflow-hidden px-6 py-12 focus:outline-none"
    >
      <div className="w-full max-w-md animate-[scale-in_0.4s_cubic-bezier(0.22,1,0.36,1)_both]">
        <div className="mb-4 flex justify-center">
          <RuntimeModeIndicator />
        </div>
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo size="lg" className="mb-4" />
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            เข้าสู่ระบบสำหรับเจ้าหน้าที่
          </h1>
          <p className="mt-1.5 text-neutral-500">เข้าสู่ระบบเพื่อจัดการงานบริการ</p>
        </div>

        <GlassCard className="p-6 sm:p-8">
          <form onSubmit={(event) => void submit(event)} className="space-y-5">
            <Field label="อีเมลที่ทำงาน">
              <div className="relative">
                <Mail className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-neutral-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className={inputClass('pl-12')}
                  placeholder="you@example.com"
                  autoComplete="email"
                  required
                />
              </div>
            </Field>
            <Field label="รหัสผ่าน">
              <div className="relative">
                <Lock className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-neutral-400" />
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className={inputClass('pl-12')}
                  placeholder="กรอกรหัสผ่าน"
                  autoComplete="current-password"
                  required
                />
              </div>
            </Field>
            <PrimaryButton type="submit" className="w-full" disabled={isSigningIn}>
              {isSigningIn ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
              <ArrowRight className="h-5 w-5" />
            </PrimaryButton>
          </form>
          <AsyncErrorAlert
            message={signInError ?? (status === 'unavailable' ? error : null)}
            className="mt-4"
          />
        </GlassCard>

        <p className="mt-6 text-center text-sm text-neutral-400">
          ต้องการสิทธิ์ใช้งานหรือไม่ ติดต่อผู้จัดการศูนย์บริการ
        </p>
      </div>
    </main>
  );
}
