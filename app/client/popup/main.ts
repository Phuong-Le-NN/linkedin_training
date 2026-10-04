import { bootstrapApplication } from '@angular/platform-browser';
import { PopupComponent } from './popup.component';

bootstrapApplication(PopupComponent).catch((error) => {
    console.error('[Low-Value Guard] Could not start popup:', error);
    const root = document.querySelector('lvg-popup');
    if (root) root.textContent = 'Could not open the popup. Reload the extension and try again.';
});
