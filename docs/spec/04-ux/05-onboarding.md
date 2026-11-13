# 05. Onboarding

## 1. Decision for MVP

Use an **inline first-run checklist**, not a multi-page modal wizard.

Reasons:

- faster to first value
- less blocking
- easier to skip/return

## 2. First-run detection

Show checklist when any of these is true:

1. no provider configured
2. no secret present for default provider
3. no session exists yet

Persist dismissal state, but incomplete critical steps can reappear as banners.

The Iterate account guide is shown first on an empty home when
`AppSettings.iterateWelcomeDismissed` is absent or false. It is removed for
the current and later launches when the user chooses **Later** or when account,
dedicated-key, and model setup complete. A restored account session pre-fills
the account step but leaves the guide visible until setup finishes. The generic
provider/key checklist remains available as the fallback path for users who
configure another OpenAI-compatible provider directly.

The guide waits for persisted settings before rendering or querying the account,
so a slow startup does not flash the first-run card. A dismissed guide performs
no account query. If the settings store is unavailable, **Later** and completed
setup remain uncommitted, report `STORAGE`, and keep the guide visible. A
transient account-load failure renders an inline retry state; the user can
retry or choose **Later** without losing the ability to enter the app.

## 3. Checklist steps

The primary Iterate path has three steps:

1. **Connect the Iterate account and finish model access**
2. **Recharge or redeem credit** in the third-party shop
3. **Choose a different model** when the automatic first choice is not wanted

The first step creates or reuses the dedicated key for the first available
server group, discovers that key's runnable models, connects the first model
with a known API style, and claims the app default only when no runnable default
already exists. The Settings page remains available for choosing another group
or model.

The fallback direct-provider checklist retains:

1. **Add a provider**
2. **Save an API key**
3. **Open a project folder**
4. **Send your first prompt**
5. *(Optional)* Load a development plugin

## 4. Placement

- shown in main chat empty state
- the Iterate connection step opens the isolated website login window and
  creates or reuses the dedicated key after the session is accepted
- after login, the guide discovers the first group's models and connects the
  first model whose response format is known; if no group or compatible model
  is available it keeps the guide visible and links to Settings → Iterate
- initialization failure keeps a retry action and the normal **Later** escape
  in the first-run card; an action failure does not replace the card
- recharge and redemption open the third-party shop in its isolated app window
  only after an explicit confirmation that explains the hand-off
- the model step deep-links to Settings → Iterate for a different choice
- provider and key items deep-link to Settings → Agent
- the optional plugin item opens the app shell's Plugins destination
- project and prompt items invoke their relevant app actions
- checklist collapses after core steps complete

## 5. Copy tone

English source, concise, action-oriented.

Example:

- “Add a model provider”
- “Save your API key”
- “Open a project to enable local tools”
- Recharge copy must state that payment stays on the third-party site. The
  returned code is submitted explicitly in Settings → Iterate; PI-Desktop never
  charges or redeems automatically.

## 6. Non-goals

- in-app account signup forms or credential collection
- in-app payment processing
- cloud sync setup
- long product tour overlays
- forced tutorial for returning users

## 7. Acceptance

1. Fresh profile shows checklist
2. Recording **Later** persists dismissal across restarts
3. A restored Iterate account keeps the guide visible until key and model
   setup completes
4. Successful setup removes the guide and persists dismissal; a restore alone
   does not
5. Recharge cancel leaves the shop unopened; explicit confirmation opens it
   exactly once
6. Completing provider+key+prompt removes critical empty-state blocker
7. User can dismiss optional parts without breaking app use
8. The guide renders and queries only after settings load; a settings write
   failure leaves it visible and reports the storage failure
9. An account initialization failure offers both retry and **Later**
