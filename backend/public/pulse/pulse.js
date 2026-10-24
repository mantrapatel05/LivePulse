(function () {
  var s = document.currentScript;
  var pid = s && s.dataset && s.dataset.publicId;
  if (!pid || !s.src) return;
  var api;
  try { api = new URL(s.src, location.href).origin; } catch (e) { return; }
  fetch(api + "/api/public/" + encodeURIComponent(pid) + "/pulse")
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d || !isFinite(Number(d.count))) return;
      var n = Number(d.count);
      var text;
      if (d.mode === "live_now") text = n + " reading now";
      else if (d.mode === "visitors_today") text = n + " visitors today";
      else return; // brand_only: leave the host page's own fallback content alone
      var els = document.querySelectorAll("[data-lp-pulse]");
      for (var i = 0; i < els.length; i++) els[i].textContent = text; // textContent only, never innerHTML
    })
    .catch(function () { /* a badge must never break the host page */ });
})();
