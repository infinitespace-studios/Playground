const proofEnabled = !document
  .querySelector('meta[http-equiv="Content-Security-Policy"]')
  ?.content.includes("'wasm-unsafe-eval'");

if (proofEnabled) {
  let reportCount = 0;
  const bounded = value => String(value ?? "").slice(0, 2048);
  const report = (eventType, details) => {
    if (reportCount++ >= 32) return;
    parent.postMessage({
      type: "issue033.negative.observation",
      eventType,
      ...details,
    }, "*");
  };

  addEventListener("securitypolicyviolation", event => {
    report("securitypolicyviolation", {
      effectiveDirective: bounded(event.effectiveDirective),
      violatedDirective: bounded(event.violatedDirective),
      blockedUri: bounded(event.blockedURI),
      disposition: bounded(event.disposition),
    });
  });
  addEventListener("unhandledrejection", event => {
    report("unhandledrejection", {
      message: bounded(event.reason instanceof Error ? event.reason.message : event.reason),
    });
  });
  addEventListener("error", event => {
    report("error", { message: bounded(event.message) });
  });
}
