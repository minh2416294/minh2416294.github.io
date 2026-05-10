(function () {
  var form = document.getElementById("contact-form");
  if (!form) return;
  var status = form.querySelector(".contact-form-status");
  var textarea = form.querySelector("textarea[name='message']");

  textarea.addEventListener("input", function () {
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight, 180) + "px";
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    status.textContent = "Sending...";
    status.className = "contact-form-status sending";

    var data = new FormData(form);
    fetch("https://api.web3forms.com/submit", { method: "POST", body: data })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j.success) {
          status.textContent = "Thanks! I'll get back to you soon.";
          status.className = "contact-form-status success";
          form.reset();
          textarea.style.height = "auto";
        } else {
          status.textContent = "Something went wrong. Please try again or email me directly.";
          status.className = "contact-form-status error";
        }
      })
      .catch(function () {
        status.textContent = "Network error. Please try again later.";
        status.className = "contact-form-status error";
      });
  });
})();
