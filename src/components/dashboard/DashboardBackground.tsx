export function DashboardBackground() {
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden">
      {/* Very subtle animated signal lines */}
      <div className="absolute inset-0 dark:opacity-[0.03] light:opacity-[0.08]">
        <div
          className="absolute top-1/4 left-0 w-full h-px dark:bg-gradient-to-r dark:from-transparent dark:via-white dark:to-transparent light:bg-gradient-to-r light:from-transparent light:via-cyan-300 light:to-transparent"
          style={{
            animation: "signalFlow 28s linear infinite",
          }}
        />
        <div
          className="absolute top-1/2 left-0 w-full h-px dark:bg-gradient-to-r dark:from-transparent dark:via-white dark:to-transparent light:bg-gradient-to-r light:from-transparent light:via-cyan-200 light:to-transparent"
          style={{
            animation: "signalFlowSlow 35s linear infinite",
          }}
        />
        <div
          className="absolute top-3/4 left-0 w-full h-px dark:bg-gradient-to-r dark:from-transparent dark:via-white dark:to-transparent light:bg-gradient-to-r light:from-transparent light:via-cyan-300 light:to-transparent"
          style={{
            animation: "signalFlowOffset 42s linear infinite",
          }}
        />
      </div>
    </div>
  );
}
