#!/usr/bin/env node
/**
 * Post-`cap add/sync android` configuration script.
 * Ensures the generated Capacitor Android project includes:
 *  1. Deep-link intent filter for `com.easvarafy.app://auth/callback` (Google OAuth PKCE).
 *  2. Adequate Gradle JVM heap (`-Xmx2048m`) for CI builds.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const manifestPath = path.join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
const gradlePropsPath = path.join(root, 'android', 'gradle.properties');

if (existsSync(manifestPath)) {
  let manifest = readFileSync(manifestPath, 'utf8');
  if (!manifest.includes('android:scheme="com.easvarafy.app"')) {
    const deepLinkFilter = `
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="com.easvarafy.app" android:host="auth" android:pathPrefix="/callback" />
            </intent-filter>`;

    const anchor = '</activity>';
    if (manifest.includes(anchor)) {
      manifest = manifest.replace(anchor, `${deepLinkFilter}\n        ${anchor}`);
      writeFileSync(manifestPath, manifest, 'utf8');
      console.log('✓ Added com.easvarafy.app://auth/callback intent-filter to AndroidManifest.xml');
    } else {
      console.warn('! Could not locate </activity> in AndroidManifest.xml');
    }
  } else {
    console.log('· Deep-link intent-filter already present in AndroidManifest.xml');
  }
} else {
  console.warn('! AndroidManifest.xml not found at', manifestPath);
}

if (existsSync(gradlePropsPath)) {
  let props = readFileSync(gradlePropsPath, 'utf8');
  if (props.includes('org.gradle.jvmargs=-Xmx1536m')) {
    props = props.replace('org.gradle.jvmargs=-Xmx1536m', 'org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8');
    writeFileSync(gradlePropsPath, props, 'utf8');
    console.log('✓ Updated org.gradle.jvmargs in android/gradle.properties');
  }
}
