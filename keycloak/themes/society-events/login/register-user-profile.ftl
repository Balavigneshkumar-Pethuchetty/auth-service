<!DOCTYPE html>
<html lang="${(locale.currentLanguageTag)!'en'}">
<head>
  <meta charset="UTF-8" />
  <meta name="robots" content="noindex, nofollow" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Register - ${realm.displayName!'Society Events'}</title>
  <link rel="stylesheet" href="${url.resourcesPath}/css/custom.css" />
</head>
<body class="auth-page">
  <main class="auth-shell">

    <!-- ══ Left hero ═══════════════════════════════════════════ -->
    <section class="auth-hero" aria-label="Registration information">
      <div class="brand-mark" aria-hidden="true">🏛</div>
      <p class="brand-place">Resident Events &amp; Community Portal</p>
      <h1>${realm.displayNameHtml!'GM Global Techies Town'}</h1>
      <p class="brand-copy">
        Create your member account to browse events, reserve seats, and
        stay connected with your community.
      </p>

      <ol class="steps-list" aria-label="How membership works">
        <li class="step-item">
          <span class="step-num step-active" aria-hidden="true">1</span>
          <div class="step-body">
            <h3>Register</h3>
            <p>Fill in your details below. Takes less than a minute.</p>
          </div>
        </li>
        <li class="step-item">
          <span class="step-num" aria-hidden="true">2</span>
          <div class="step-body">
            <h3>Committee Review</h3>
            <p>A committee member verifies your residency — usually within 24 hours.</p>
          </div>
        </li>
        <li class="step-item">
          <span class="step-num" aria-hidden="true">3</span>
          <div class="step-body">
            <h3>Full Access</h3>
            <p>Browse events, book tickets, and pay online.</p>
          </div>
        </li>
      </ol>

      <div class="category-row" aria-label="Event categories">
        <span>Festival</span>
        <span>Sports</span>
        <span>Wellness</span>
        <span>Governance</span>
      </div>
    </section>

    <!-- ══ Right panel ══════════════════════════════════════════ -->
    <section class="auth-panel" aria-labelledby="register-title">
      <div class="panel-header">
        <div class="panel-mark" aria-hidden="true">✏️</div>
        <div>
          <p>${realm.displayName!'Society Events'}</p>
          <h2 id="register-title">Create your account</h2>
        </div>
      </div>

      <div class="pending-banner" role="note">
        <span class="banner-icon" aria-hidden="true">⏳</span>
        <span>After registering, a committee member will activate your account within 24 hours.</span>
      </div>

      <#if message?has_content>
        <div class="alert alert-${message.type!'error'}" role="alert">
          ${kcSanitize(message.summary)?no_esc}
        </div>
      </#if>

      <form action="${url.registrationAction}" method="post" class="auth-form">

        <!-- First name + Last name side by side -->
        <div class="field-row">
          <div class="field">
            <label for="firstName">First name</label>
            <input
              type="text"
              id="firstName"
              name="firstName"
              value="${(profile.attributesByName['firstName'].value)!''}"
              autocomplete="given-name"
              autofocus
              aria-invalid="<#if messagesPerField.existsError('firstName')>true<#else>false</#if>"
            />
            <#if messagesPerField.existsError('firstName')>
              <span class="field-error">
                ${kcSanitize(messagesPerField.getFirstError('firstName'))?no_esc}
              </span>
            </#if>
          </div>

          <div class="field">
            <label for="lastName">Last name</label>
            <input
              type="text"
              id="lastName"
              name="lastName"
              value="${(profile.attributesByName['lastName'].value)!''}"
              autocomplete="family-name"
              aria-invalid="<#if messagesPerField.existsError('lastName')>true<#else>false</#if>"
            />
            <#if messagesPerField.existsError('lastName')>
              <span class="field-error">
                ${kcSanitize(messagesPerField.getFirstError('lastName'))?no_esc}
              </span>
            </#if>
          </div>
        </div>

        <!-- Email -->
        <div class="field">
          <label for="email">Email address</label>
          <input
            type="email"
            id="email"
            name="email"
            value="${(profile.attributesByName['email'].value)!''}"
            autocomplete="email"
            aria-invalid="<#if messagesPerField.existsError('email')>true<#else>false</#if>"
          />
          <#if messagesPerField.existsError('email')>
            <span class="field-error">
              ${kcSanitize(messagesPerField.getFirstError('email'))?no_esc}
            </span>
          </#if>
        </div>

        <!-- Username — only when email is NOT used as username -->
        <#if !realm.registrationEmailAsUsername>
          <div class="field">
            <label for="username">Username</label>
            <input
              type="text"
              id="username"
              name="username"
              value="${(profile.attributesByName['username'].value)!''}"
              autocomplete="username"
              aria-invalid="<#if messagesPerField.existsError('username')>true<#else>false</#if>"
            />
            <#if messagesPerField.existsError('username')>
              <span class="field-error">
                ${kcSanitize(messagesPerField.getFirstError('username'))?no_esc}
              </span>
            </#if>
          </div>
        </#if>

        <!-- Password fields — present when password credential is required -->
        <#if passwordRequired??>
          <div class="field">
            <label for="password">Password</label>
            <div class="password-wrap">
              <input
                type="password"
                id="password"
                name="password"
                autocomplete="new-password"
                aria-invalid="<#if messagesPerField.existsError('password')>true<#else>false</#if>"
              />
              <button type="button" class="icon-button" id="toggle-password" aria-label="Show password">
                Show
              </button>
            </div>
            <#if messagesPerField.existsError('password')>
              <span class="field-error">
                ${kcSanitize(messagesPerField.getFirstError('password'))?no_esc}
              </span>
            </#if>
          </div>

          <div class="field">
            <label for="password-confirm">Confirm password</label>
            <div class="password-wrap">
              <input
                type="password"
                id="password-confirm"
                name="password-confirm"
                autocomplete="new-password"
                aria-invalid="<#if messagesPerField.existsError('password-confirm')>true<#else>false</#if>"
              />
              <button type="button" class="icon-button" id="toggle-confirm" aria-label="Show confirm password">
                Show
              </button>
            </div>
            <#if messagesPerField.existsError('password-confirm')>
              <span class="field-error">
                ${kcSanitize(messagesPerField.getFirstError('password-confirm'))?no_esc}
              </span>
            </#if>
          </div>
        </#if>

        <button type="submit" class="primary-button">Create Account</button>
      </form>

      <p class="register-copy">
        Already have an account?
        <a class="text-link strong" href="${url.loginUrl}">Sign In</a>
      </p>

      <p class="approval-note">
        Your account will be pending committee approval before you can access events.
      </p>
    </section>
  </main>

  <script>
    (function () {
      function wireToggle(inputId, buttonId) {
        var input  = document.getElementById(inputId);
        var button = document.getElementById(buttonId);
        if (!input || !button) return;
        button.addEventListener('click', function () {
          var show = input.type === 'password';
          input.type = show ? 'text' : 'password';
          button.textContent = show ? 'Hide' : 'Show';
          button.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
        });
      }
      wireToggle('password',         'toggle-password');
      wireToggle('password-confirm', 'toggle-confirm');
    })();
  </script>
</body>
</html>
