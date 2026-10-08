window.pngSegmentWorkerReady = new Promise((resolve, reject) => {
  if (!("serviceWorker" in navigator)) {
    reject(new Error("Service worker unavailable. Open this player on localhost or HTTPS."));
    return;
  }
  const workerURL = new URL("/sw.js?v=2", window.location.href).href;
  const serviceWorker = navigator.serviceWorker;
  let settled = false;
  const finish = (error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    serviceWorker.removeEventListener("controllerchange", checkController);
    if (error) reject(error);
    else resolve();
  };
  const checkController = () => {
    if (serviceWorker.controller?.scriptURL === workerURL) finish();
  };
  const timer = setTimeout(() => finish(new Error(
    "Timed out waiting for the PNG service worker. Reload the player (Ctrl + Shift + R)."
  )), 15000);
  serviceWorker.addEventListener("controllerchange", checkController);
  serviceWorker.register(workerURL, { scope: "/", updateViaCache: "none" })
    .then(checkController)
    .catch((error) => finish(new Error(`Cannot register PNG service worker: ${error.message}`)));
});
// Handle early rejection while Video.js is still loading.
window.pngSegmentWorkerReady.catch(() => {});
