import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';

@Component({
    selector: 'lvg-popup',
    standalone: true,
    templateUrl: './popup.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class PopupComponent implements OnInit {
    readonly enabled = signal(false);
    readonly mode = signal<'blur' | 'remove'>('blur');
    readonly pending = signal(false);
    readonly status = signal('Loading preferences...');
    readonly error = signal('');

    ngOnInit(): void {
        void this.loadSettings();

    }

    private async loadSettings(): Promise<void> {
        try {
            const saved = await chrome.storage.sync.get({ isEnabled: false, filterMode: 'blur' });
            this.enabled.set(saved.isEnabled === true);
            this.mode.set(saved.filterMode === 'remove' ? 'remove' : 'blur');
            this.status.set(this.enabled() ? 'Filtering is on' : 'Filtering is paused');
        } catch {
            this.error.set('Could not load preferences.');
        }
    }

    async changeEnabled(event: Event): Promise<void> {
        await this.save({ isEnabled: (event.target as HTMLInputElement).checked });
    }

    async changeMode(event: Event): Promise<void> {
        const filterMode = (event.target as HTMLSelectElement).value;
        if (filterMode === 'blur' || filterMode === 'remove') {
            await this.save({ filterMode });
        }
    }

    private async save(update: { isEnabled?: boolean; filterMode?: 'blur' | 'remove' }): Promise<void> {
        this.pending.set(true);
        this.error.set('');
        try {
            await chrome.storage.sync.set(update);
            await this.loadSettings();
        } catch {
            this.error.set('Could not save preferences.');
        } finally {
            this.pending.set(false);
        }
    }


}
