export function DashboardBackground() {
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden">
      {/* Very subtle animated signal lines */}
      <div className="absolute inset-0 opacity-[0.03]">
        <div
          className="absolute top-1/4 left-0 w-full h-px bg-gradient-to-r from-transparent via-white to-transparent"
          style={{
            animation: "signalFlow 28s linear infinite",
          }}
        />
        <div
          className="absolute top-1/2 left-0 w-full h-px bg-gradient-to-r from-transparent via-white to-transparent"
          style={{
            animation: "signalFlowSlow 35s linear infinite",
          }}
        />
        <div
          className="absolute top-3/4 left-0 w-full h-px bg-gradient-to-r from-transparent via-white to-transparent"
          style={{
            animation: "signalFlowOffset 42s linear infinite",
          }}
        />
      </div>
    </div>
  );
}
