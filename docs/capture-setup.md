# Capture setup

The whole point of M1: a full day logs from your phone without opening a browser.

Everything below hits one endpoint:

```
POST https://<your-app>/api/switch
Authorization: Bearer <SHORTCUT_TOKEN>
Content-Type: application/json

{ "category": "deep-work" }
```

It replies with a sentence built for a notification:

```
"Deep work started. Meetings closed at 47m."
```

Tapping the same category twice does nothing the second time — it returns
`"Deep work already running."` and writes nothing, so a fumbled double-tap can't
split one block into two.

Get the token with `vercel env pull .env.local --environment=development` and read
`SHORTCUT_TOKEN`. It's long-lived; treat it like a password. If it leaks, generate
a new one and update the env var — nothing else depends on it.

## Category slugs

```
deep-work          meetings           email-admin        kids-active
household-chores   media-scroll       commute            kids-logistics
exercise           meals              errands            personal-projects
social-family      sleep
```

The six marked `is_quick` — deep-work, meetings, email-admin, kids-active,
household-chores, media-scroll — are the ones worth a home-screen slot. The rest
are reachable from the app.

---

## Android (Samsung) — recommended

**HTTP Shortcuts** (free, open source, on F-Droid and Play) is the closest thing
to purpose-built for this. It gives one home-screen icon *per category*, so a
switch is genuinely one tap — better than the iOS menu, which costs two.

1. Install **HTTP Shortcuts**.
2. Create a shortcut:
   - **Method** `POST`, **URL** `https://<your-app>/api/switch`
   - **Headers**: `Authorization: Bearer <SHORTCUT_TOKEN>`
   - **Request body** → Content type `application/json`, body `{"category":"deep-work"}`
   - **Response** → *Display in* → **Toast** (shows the `message` field's sentence)
3. Duplicate it once per quick category, changing only the slug and the name.
4. Long-press each → **Place on home screen**. Or add the *HTTP Shortcuts* widget
   and put all six in one grid.

A six-cell widget on your main home screen is the target. Tap "Deep work", get a
toast, carry on.

### Installing the app itself

Chrome → your app URL → menu → **Add to Home screen**. It opens fullscreen with no
browser chrome. There is nothing to sideload and no developer account involved —
it's a web app, not an APK.

---

## iPhone

Works, but costs an extra tap, and on a **work phone** MDM may disable Shortcuts
or web clips entirely. Worth knowing before you build around it. Also consider
what you're logging: this is family, health and side-project data on a device your
employer manages.

1. **Shortcuts** app → new shortcut.
2. **Choose from Menu** with one item per quick category.
3. Under each item: **Get Contents of URL**
   - URL `https://<your-app>/api/switch`, Method `POST`
   - Headers: `Authorization` = `Bearer <SHORTCUT_TOKEN>`
   - Request Body **JSON**: key `category` (Text) = the slug
4. After the menu: **Show Notification** with `Contents of URL` → `message`.
5. Assign it to the **Action Button** (iPhone 15 Pro and newer) or **Back Tap**
   (Settings → Accessibility → Touch → Back Tap).

Add the PWA with Safari → Share → **Add to Home Screen**.

---

## Checking it works

```bash
curl -X POST https://<your-app>/api/switch \
  -H "Authorization: Bearer $SHORTCUT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"category":"deep-work"}'
```

| Response | Meaning |
|---|---|
| `401 unauthorized` | Token missing or wrong |
| `404 unknown_category` | Slug typo — check the list above |
| `400 missing_category` | Body didn't parse; check the content type |
| `200 ok` | Switched, or already running |

## Week one

Expect it to be bad. The habit takes days to form and the plan already budgets for
discarding week one. Two things that matter more than completeness:

- **Tap on transition, not in arrears.** The app never asks how long something
  took; it only asks what you're doing now.
- **A failed tap must not pass silently.** The PWA rolls back and shows *"Not
  saved — tap again"* in red. On the phone shortcut, if you don't see the toast,
  it didn't land. A gap you know about is recoverable at reconcile; a gap you
  don't know about is corrupt data.
