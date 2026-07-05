import { SignIn } from "@clerk/nextjs";

export default function Page() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950 px-4">
      <SignIn 
        appearance={{
          elements: {
            formButtonPrimary: "bg-zinc-900 hover:bg-zinc-800 text-sm normal-case dark:bg-zinc-100 dark:hover:bg-zinc-200 dark:text-zinc-900",
            card: "border border-zinc-200 dark:border-zinc-800 shadow-lg dark:bg-zinc-900",
          }
        }} 
      />
    </div>
  );
}
