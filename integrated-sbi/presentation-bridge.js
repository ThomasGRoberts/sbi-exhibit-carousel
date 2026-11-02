// The standalone tool retains its normal project link. Only an explicitly
// embedded carousel session replaces that link with a return action.
const parameters = new URLSearchParams(location.search);
const returnOrigin = parameters.get("returnOrigin");
const token = parameters.get("presentationToken");
const trustedOrigin = returnOrigin === "https://thomasgroberts.github.io" ||
  /^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/.test(returnOrigin || "");
let referrerOrigin = null;
try { referrerOrigin = new URL(document.referrer).origin; } catch { /* no referrer */ }

if (window.parent !== window && parameters.get("presentation") === "carousel" &&
    trustedOrigin && referrerOrigin === returnOrigin &&
    /^[A-Za-z0-9_-]{16,128}$/.test(token || "")) {
  const link = document.getElementById("projectLink");
  const label = link?.querySelector(".projectLinkLabel");
  if (link && label?.firstChild?.nodeType === Node.TEXT_NODE) {
    label.firstChild.textContent = "Back to Presentation";
    link.href = "#";
    link.target = "_self";
    link.title = "Back to Presentation";
    link.setAttribute("aria-label", "Back to Presentation");
    link.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      window.parent.postMessage({ type:"sbi-carousel:return", token }, returnOrigin);
    });
    const ready = () => window.parent.postMessage(
      { type:"sbi-carousel:ready", token }, returnOrigin);
    if (document.readyState === "complete") ready();
    else window.addEventListener("load", ready, { once:true });
  }
}
