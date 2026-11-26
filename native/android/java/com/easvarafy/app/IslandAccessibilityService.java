package com.easvarafy.app;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.view.accessibility.AccessibilityEvent;

/**
 * Hosts the system-wide Dynamic Island.
 *
 * Only an accessibility service may add a TYPE_ACCESSIBILITY_OVERLAY window,
 * the one window type that a regular app can draw ABOVE the status bar, i.e.
 * right around the front camera like the iPhone Dynamic Island. This service
 * does not read screen content; it only provides that window.
 */
public class IslandAccessibilityService extends AccessibilityService {
    private static volatile boolean running = false;

    static boolean isRunning() {
        return running;
    }

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        running = true;
        DynamicIslandController.get(this).onAccessibilityConnected(this);
        MediaPlaybackService.refreshIsland();
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        // Not used – the service exists only to host the island overlay window.
    }

    @Override
    public void onInterrupt() {}

    @Override
    public boolean onUnbind(Intent intent) {
        running = false;
        DynamicIslandController.get(this).onAccessibilityDisconnected(this);
        return super.onUnbind(intent);
    }

    @Override
    public void onDestroy() {
        running = false;
        DynamicIslandController.get(this).onAccessibilityDisconnected(this);
        super.onDestroy();
    }
}
