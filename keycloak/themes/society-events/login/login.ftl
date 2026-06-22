<!DOCTYPE html>
<html lang="${(locale.currentLanguageTag)!'en'}">
<head>
  <meta charset="UTF-8" />
  <meta name="robots" content="noindex, nofollow" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Sign In - ${realm.displayName!'Society Events'}</title>
  <link rel="stylesheet" href="${url.resourcesPath}/css/custom.css" />
</head>
<body class="auth-page">
  <main class="auth-shell">
    <section class="auth-hero" aria-label="${realm.displayName!'Society Events'}">
      <div class="brand-mark" aria-hidden="true">🏛</div>
      <p class="brand-place">Resident Events &amp; Community Portal</p>
      <h1>${realm.displayNameHtml!'GM Global Techies Town'}</h1>
      <p class="brand-copy">
        Browse society events, reserve seats, and manage community access with one secure account.
      </p>

      <dl class="stats-strip" aria-label="Community highlights">
        <div>
          <dt>30+</dt>
          <dd>Events per year</dd>
        </div>
        <div>
          <dt>500+</dt>
          <dd>Resident families</dd>
        </div>
        <div>
          <dt>24h</dt>
          <dd>Approval turnaround</dd>
        </div>
      </dl>

      <div class="category-row" aria-label="Event categories">
        <span>Festival</span>
        <span>Sports</span>
        <span>Wellness</span>
        <span>Governance</span>
      </div>
    </section>

    <section class="auth-panel" aria-labelledby="login-title">
      <div class="panel-header">
        <div class="panel-mark" aria-hidden="true">🏛</div>
        <div>
          <p>${realm.displayName!'Society Events'}</p>
          <h2 id="login-title">Sign in to your account</h2>
        </div>
      </div>

      <#if message?has_content>
        <div class="alert alert-${message.type!'error'}" role="alert">
          ${kcSanitize(message.summary)?no_esc}
        </div>
      </#if>

      <form action="${url.loginAction}" method="post" class="auth-form">
        <#if selectedCredential?has_content>
          <input type="hidden" name="credentialId" value="${selectedCredential}" />
        </#if>

        <div class="field">
          <label for="username">
            <#if !realm.loginWithEmailAllowed>
              Username
            <#elseif !realm.registrationEmailAsUsername>
              Username or email
            <#else>
              Email address
            </#if>
          </label>
          <input
            type="text"
            id="username"
            name="username"
            value="${(login.username!'')}"
            autocomplete="username"
            <#if !usernameEditDisabled??>autofocus</#if>
            <#if usernameEditDisabled??>readonly</#if>
            aria-invalid="<#if messagesPerField?? && messagesPerField.existsError('username')>true<#else>false</#if>"
          />
          <#if messagesPerField?? && messagesPerField.existsError('username')>
            <span class="field-error">
              ${kcSanitize(messagesPerField.getFirstError('username'))?no_esc}
            </span>
          </#if>
        </div>

        <div class="field">
          <label for="password">Password</label>
          <div class="password-wrap">
            <input
              type="password"
              id="password"
              name="password"
              autocomplete="current-password"
              <#if usernameEditDisabled??>autofocus</#if>
              aria-invalid="<#if messagesPerField?? && messagesPerField.existsError('password')>true<#else>false</#if>"
            />
            <button type="button" class="icon-button" id="toggle-password" aria-label="Show password">
              <span aria-hidden="true">Show</span>
            </button>
          </div>
          <#if messagesPerField?? && messagesPerField.existsError('password')>
            <span class="field-error">
              ${kcSanitize(messagesPerField.getFirstError('password'))?no_esc}
            </span>
          </#if>
        </div>

        <div class="form-row">
          <#if realm.rememberMe && !(usernameEditDisabled??)>
            <label class="check-label">
              <input
                type="checkbox"
                name="rememberMe"
                <#if login.rememberMe?? && login.rememberMe == "on">checked</#if>
              />
              <span>Remember me</span>
            </label>
          <#else>
            <span></span>
          </#if>

          <#if realm.resetPasswordAllowed>
            <a class="text-link" href="${url.loginResetCredentialsUrl}">Forgot password?</a>
          </#if>
        </div>

        <button type="submit" class="primary-button">Sign In</button>
      </form>

      <#if social?? && social.providers?has_content>
        <div class="divider"><span>or continue with</span></div>
        <div class="provider-list">
          <#list social.providers as p>
            <a class="provider-button" href="${p.loginUrl}" id="social-${p.alias}">
              ${p.displayName!p.alias}
            </a>
          </#list>
        </div>
      </#if>

      <#if realm.registrationAllowed && !usernameEditDisabled??>
        <p class="register-copy">
          New to ${realm.displayName!'the portal'}?
          <a class="text-link strong" href="${url.registrationUrl}">Register as Member</a>
        </p>
      </#if>

      <p class="approval-note">New resident accounts are activated after committee verification.</p>
    </section>
  </main>

  <script>
    (function () {
      var input = document.getElementById('password');
      var button = document.getElementById('toggle-password');

      if (!input || !button) return;

      button.addEventListener('click', function () {
        var shouldShow = input.type === 'password';
        input.type = shouldShow ? 'text' : 'password';
        button.setAttribute('aria-label', shouldShow ? 'Hide password' : 'Show password');
        button.textContent = shouldShow ? 'Hide' : 'Show';
      });
    })();
  </script>
</body>
</html>
