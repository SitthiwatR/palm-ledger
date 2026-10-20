import { Login } from "@/ui/ledger";
export default function LoginPage() {
  return (
    <Login
      support={
        process.env.SUPPORT_CONTACT ||
        "ติดต่อผู้ดูแลที่ช่วยตั้งระบบให้คุณ เพื่อตั้งรหัสผ่านใหม่"
      }
    />
  );
}
