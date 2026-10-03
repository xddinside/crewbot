# Platform support

Linux is the only supported platform during active development. The goal is dependable daily use, reliable agent turns and recovery, and lower token and cache costs. Native Android, iOS, macOS, and Windows clients remain in the source tree, but their builds and acceptance are parked. Their proof is deferred, never passed.

## Linux coverage

The development target is Arch Linux. Ubuntu 24.04 x86_64 is the reference for package builds and CI. Current desktop-session evidence is specific to GNOME on Xorg and GNOME on Wayland. These facts do not establish support for other distributions, desktop environments, or ARM64. The CI Cloudflare connector installer smoke on ARM64 checks connector staging only; it does not prove an ARM64 desktop package.

The Linux package workflow covers artifact construction and package-level checks. Linux installed acceptance is still pending. Before claiming dependable installed use, verify data, attachment, and credential continuity; stable/development isolation; permission behavior and Stop; service rollback; and recovery of the exact failed turn through the folder picker. Use isolated fixtures with synthetic credentials and disposable homes. Follow the [verification guide](verification/README.md) for server or conversation checks. Xvfb and synthetic tests establish only what they exercise.

Local computer behavior also depends on the session. GNOME/Xorg permits explicit opt-in control under the documented safety checks. GNOME/Wayland supports explicit preview through the portal, while local control remains disabled behind its safety gate. See the [Ubuntu Desktop guide](linux-desktop.md) for the current behavior and evidence.

## Shared code and platform boundaries

Keep the server and shared protocols portable. Existing desktop and platform adapters own OS-specific behavior; renderer code uses their capability contracts. Shared code should use filesystem and process APIs and pass argument arrays rather than assuming Linux paths or shell behavior. Preserve the current boundaries without adding portability layers for platforms that are parked.

Parking a client does not remove the shared protocol and security tests Linux uses. Keep companion sidecars and ADB tools that support existing Linux features. Preserve legal attribution and recovery data when changing builds or packages.

## Returning to native support

Android is reconsidered after Linux daily use is dependable. macOS, Windows, and iOS are reconsidered after public release and demonstrated demand. Resuming any platform requires an explicit product decision and fresh proof on supported native environments. A parked platform's old recipes and source remain available, but they do not count as current acceptance.
