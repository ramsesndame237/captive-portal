(() => {
  'use strict';

  // --- Paramètres passés par UniFi dans l'URL de redirection ---
  // ex: ?ap=94:2a:6f:d0:30:57&id=1c:71:25:63:e4:24&t=...&url=...&ssid=...
  const params = new URLSearchParams(window.location.search);
  const context = {
    clientMac: params.get('id') || null,
    apMac: params.get('ap') || null,
    ssid: params.get('ssid') || null,
    redirectUrl: params.get('url') || null,
  };

  if (context.ssid) {
    document.getElementById('eyebrow').textContent = context.ssid;
  }

  // --- Références DOM ---
  const steps = {
    phone: document.getElementById('step-phone'),
    welcomeBack: document.getElementById('step-welcome-back'),
    register: document.getElementById('step-register'),
    success: document.getElementById('step-success'),
    error: document.getElementById('step-error'),
  };

  const phonePill = document.getElementById('phone-pill');
  const phonePillValue = document.getElementById('phone-pill-value');

  const formPhone = document.getElementById('form-phone');
  const inputPhone = document.getElementById('input-phone');
  const errorPhone = document.getElementById('error-phone');
  const btnPhoneSubmit = document.getElementById('btn-phone-submit');

  const formRegister = document.getElementById('form-register');
  const inputName = document.getElementById('input-name');
  const inputEmail = document.getElementById('input-email');
  const errorName = document.getElementById('error-name');
  const errorEmail = document.getElementById('error-email');
  const btnRegisterSubmit = document.getElementById('btn-register-submit');

  const successHeading = document.getElementById('success-heading');
  const successSubcopy = document.getElementById('success-subcopy');
  const btnContinue = document.getElementById('btn-continue');

  const welcomeBackHeading = document.getElementById('welcome-back-heading');
  const welcomeBackSubcopy = document.getElementById('welcome-back-subcopy');

  const errorMessage = document.getElementById('error-message');
  const btnRetry = document.getElementById('btn-retry');

  let currentPhone = '';

  function showStep(name) {
    Object.values(steps).forEach((el) => { el.hidden = true; });
    steps[name].hidden = false;
  }

  function setFieldError(el, message) {
    if (message) {
      el.textContent = message;
      el.hidden = false;
    } else {
      el.hidden = true;
      el.textContent = '';
    }
  }

  function showPhonePill(phone) {
    phonePillValue.textContent = phone;
    phonePill.hidden = false;
  }

  function hidePhonePill() {
    phonePill.hidden = true;
  }

  async function postJSON(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  }

  function showSuccess({ firstName, authorized, isReturning }) {
    if (isReturning) {
      successHeading.textContent = firstName ? `Bon retour, ${firstName}.` : 'Bon retour parmi nous.';
    } else {
      successHeading.textContent = firstName ? `Merci, ${firstName}.` : 'Vous êtes connecté.';
    }

    if (authorized) {
      successSubcopy.textContent = context.redirectUrl
        ? 'Redirection en cours...'
        : 'Vous pouvez fermer cette page et naviguer normalement.';
    } else {
      successSubcopy.textContent = "Vos informations sont enregistrées, mais la connexion automatique a échoué. Merci de contacter le personnel sur place.";
    }

    showStep('success');

    if (authorized && context.redirectUrl) {
      btnContinue.hidden = false;
      const target = decodeURIComponent(context.redirectUrl);
      btnContinue.onclick = () => { window.location.href = target; };
      window.setTimeout(() => { window.location.href = target; }, 1800);
    } else if (authorized) {
      btnContinue.hidden = true;
    } else {
      btnContinue.hidden = true;
    }
  }

  function showError(message) {
    errorMessage.textContent = message || 'Merci de réessayer dans un instant.';
    showStep('error');
  }

  // --- Étape 1 : soumission du numéro de téléphone ---
  formPhone.addEventListener('submit', async (e) => {
    e.preventDefault();
    setFieldError(errorPhone, null);

    const phone = inputPhone.value.trim();
    if (!phone) {
      setFieldError(errorPhone, 'Merci d\'entrer votre numéro.');
      return;
    }

    btnPhoneSubmit.disabled = true;
    btnPhoneSubmit.textContent = 'Vérification...';

    try {
      const { ok, data } = await postJSON('/api/lookup', { phone });

      if (!ok) {
        setFieldError(errorPhone, data.error || 'Numéro invalide.');
        return;
      }

      currentPhone = phone;
      showPhonePill(phone);

      if (data.found) {
        showStep('welcomeBack');
        await checkin(phone, data.firstName);
      } else {
        showStep('register');
        inputName.focus();
      }
    } catch (err) {
      showError("Impossible de contacter le portail. Vérifiez votre connexion et réessayez.");
    } finally {
      btnPhoneSubmit.disabled = false;
      btnPhoneSubmit.textContent = 'Continuer';
    }
  });

  // --- Étape 2a : visiteur reconnu -> autorisation automatique ---
  async function checkin(phone, firstNameHint) {
    welcomeBackHeading.textContent = firstNameHint ? `Bon retour, ${firstNameHint}.` : 'Bon retour parmi nous.';
    welcomeBackSubcopy.textContent = 'Connexion en cours...';

    try {
      const { ok, data } = await postJSON('/api/checkin', {
        phone,
        clientMac: context.clientMac,
        apMac: context.apMac,
      });

      if (!ok) {
        // Fiche introuvable côté serveur (cas limite) : on repasse par l'inscription complète.
        showStep('register');
        return;
      }

      showSuccess({ firstName: data.firstName, authorized: data.authorized, isReturning: true });
    } catch (err) {
      showError("Impossible de contacter le portail. Vérifiez votre connexion et réessayez.");
    }
  }

  // --- Étape 2b : nouveau visiteur -> inscription complète ---
  formRegister.addEventListener('submit', async (e) => {
    e.preventDefault();
    setFieldError(errorName, null);
    setFieldError(errorEmail, null);

    const name = inputName.value.trim();
    const email = inputEmail.value.trim();
    let hasError = false;

    if (!name) {
      setFieldError(errorName, 'Merci d\'entrer votre nom.');
      hasError = true;
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setFieldError(errorEmail, 'Adresse email invalide.');
      hasError = true;
    }
    if (hasError) return;

    btnRegisterSubmit.disabled = true;
    btnRegisterSubmit.textContent = 'Connexion...';

    try {
      const { ok, data } = await postJSON('/api/register', {
        name,
        email,
        phone: currentPhone,
        clientMac: context.clientMac,
        apMac: context.apMac,
      });

      if (!ok) {
        showError(data.error || "Impossible de finaliser l'inscription.");
        return;
      }

      showSuccess({ firstName: data.firstName, authorized: data.authorized, isReturning: false });
    } catch (err) {
      showError("Impossible de contacter le portail. Vérifiez votre connexion et réessayez.");
    } finally {
      btnRegisterSubmit.disabled = false;
      btnRegisterSubmit.textContent = 'Se connecter à internet';
    }
  });

  // --- Puce téléphone : revenir à l'étape 1 pour corriger le numéro ---
  phonePill.addEventListener('click', () => {
    hidePhonePill();
    showStep('phone');
    inputPhone.focus();
    inputPhone.select();
  });

  // --- Réessayer après une erreur générique ---
  btnRetry.addEventListener('click', () => {
    if (currentPhone) {
      showStep('welcomeBack');
      checkin(currentPhone);
    } else {
      showStep('phone');
    }
  });
})();
