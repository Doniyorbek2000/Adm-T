import { Navbar } from "@/components/Navbar";
import { DashboardShell } from "@/components/DashboardShell";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <Navbar />
      <DashboardShell variant="user">{children}</DashboardShell>
    </div>
  );
}
