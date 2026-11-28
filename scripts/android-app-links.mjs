import config from '../config/android-app-links.json' with { type: 'json' };

export function configureAppLinks(manifest) {
  const marker = '<!-- Easvarafy verified content links -->';
  if (manifest.includes(marker)) return manifest;
  if (!manifest.includes('</activity>')) throw new Error('Cannot register App Links: activity missing');
  return manifest.replace('</activity>', `${marker}
            <intent-filter android:autoVerify="true">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="https" />
                <data android:host="${config.host}" />
                <data android:pathPrefix="/playlist/" />
                <data android:pathPrefix="/profile/" />
            </intent-filter>
        </activity>`);
}
