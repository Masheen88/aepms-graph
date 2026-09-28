// Vue's Composition API powers the editor; Tailwind is compiled by Vite.
import { createApp } from "vue";
import App from "./App.vue";
import "./style.css";

createApp(App).mount("#app");

// The web build remains fully usable without the optional report server. In a
// production HTTPS deployment, cache the app shell/assets so an iPhone/iPad can
// add it to the Home Screen and reopen it even when connectivity is poor.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.warn("Offline web-app cache could not be registered:", error);
    });
  });
}
