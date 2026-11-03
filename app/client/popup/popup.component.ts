import type { OnDestroy, OnInit } from '@angular/core';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import type { User } from 'firebase/auth/web-extension';
import type { FeedSettings } from '../lib/contracts';
import { DEFAULT_SETTINGS } from '../lib/settings.js';
import { PopupService } from './popup.service';

@Component({
    selector: 'lvg-popup',
    standalone: true,
    imports: [ReactiveFormsModule],
    templateUrl: './popup.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class PopupComponent implements OnInit, OnDestroy {
    private readonly api = inject(PopupService);
    private unsubscribe?: () => void;
    private userRequest = 0;

    readonly user = signal<User | null>(null);
    readonly authState = signal<'loading' | 'ready' | 'error'>('loading');
    readonly authReady = computed(() => this.authState() === 'ready');
    readonly authPending = signal(false);
    readonly authError = signal('');
    readonly authStatus = computed(() => {
        if (this.authState() === 'loading') return 'Checking sign-in…';
        if (this.authState() === 'error') return 'Could not load your sign-in state.';
        const user = this.user();
        return user
            ? `Signed in as ${user.email || 'your account'}`
            : 'Using the shared model. Sign in to save feedback and train your model.';
    });
    readonly training = signal({ pending: false, status: '', link: '' });
    readonly enabledControl = new FormControl(false, { nonNullable: true });
    readonly modeControl = new FormControl<'blur' | 'hide'>('blur', { nonNullable: true });
    readonly settings = signal<FeedSettings>({ ...DEFAULT_SETTINGS });
    readonly settingsReady = signal(false);
    readonly settingsPending = signal(false);
    readonly settingsLoadError = signal('');
    readonly settingsSaveError = signal('');
    readonly guideError = signal('');
    readonly popupError = computed(
        () => this.settingsLoadError() || this.settingsSaveError() || this.guideError()
    );
    readonly filterStatus = computed(() =>
        !this.settingsReady()
            ? this.settingsLoadError()
                ? 'Settings unavailable'
                : 'Loading settings…'
            : this.settings().isEnabled
              ? 'Filtering is on'
              : 'Filtering is paused'
    );
    readonly modeDescription = computed(() =>
        this.settings().filterMode === 'hide'
            ? 'Filtered posts are hidden from your feed.'
            : 'Select “Show post” to reveal a blurred post.'
    );

    ngOnInit(): void {
        this.unsubscribe = this.api.watchUser(
            (user) => {
                this.user.set(user);
                this.authState.set('ready');
                this.authError.set('');
                this.userRequest++;
                this.training.set({ pending: false, status: '', link: '' });
            },
            () => {
                this.authState.set('error');
            }
        );
        void this.loadSettings();
    }

    ngOnDestroy(): void {
        this.unsubscribe?.();
        this.userRequest++;
    }

    private async loadSettings(): Promise<void> {
        try {
            this.settings.set(await this.api.getSettings());
            this.syncControls();
            this.settingsReady.set(true);
        } catch {
            this.settingsLoadError.set(
                'Could not load your preferences. Close and reopen this popup to retry.'
            );
        }
    }

    async authenticate(
        event: SubmitEvent,
        email: HTMLInputElement,
        password: HTMLInputElement
    ): Promise<void> {
        event.preventDefault();
        if (this.authPending()) return;
        const createAccount = (event.submitter as HTMLButtonElement | null)?.value === 'sign-up';
        this.authPending.set(true);
        this.authError.set('');
        try {
            await this.api.authenticate(email.value, password.value, createAccount);
            email.value = password.value = '';
        } catch {
            this.authError.set(
                createAccount
                    ? 'Could not create an account. Check your email and password.'
                    : 'Could not sign in. Check your email and password.'
            );
        } finally {
            this.authPending.set(false);
        }
    }

    async signOut(): Promise<void> {
        if (this.authPending()) return;
        this.authPending.set(true);
        this.authError.set('');
        try {
            await this.api.signOut();
        } catch {
            this.authError.set('Could not sign out. Please try again.');
        } finally {
            this.authPending.set(false);
        }
    }

    async saveSettings(changes: Partial<FeedSettings>): Promise<void> {
        if (!this.settingsReady() || this.settingsPending()) return;
        this.settingsPending.set(true);
        this.settingsSaveError.set('');
        try {
            this.settings.set(await this.api.updateSettings(changes));
        } catch {
            this.settingsSaveError.set('Could not save your changes. Please try again.');
        } finally {
            this.syncControls();
            this.settingsPending.set(false);
        }
    }

    private syncControls(): void {
        const settings = this.settings();
        this.enabledControl.setValue(settings.isEnabled, { emitEvent: false });
        this.modeControl.setValue(settings.filterMode, { emitEvent: false });
    }

    async openGuide(): Promise<void> {
        this.guideError.set('');
        try {
            await this.api.openGuide();
        } catch {
            this.guideError.set('Could not open the guide. Please try again.');
        }
    }

    countFeedback(): Promise<void> {
        return this.runUserAction('count');
    }

    trainModel(): Promise<void> {
        return this.runUserAction('train');
    }

    private async runUserAction(action: 'count' | 'train'): Promise<void> {
        const user = this.user();
        if (!user || this.training().pending) return;
        const request = ++this.userRequest;
        this.training.set({ pending: true, status: 'Loading…', link: '' });
        try {
            if (action === 'count') {
                const data = await this.api.getFeedbackCount(user);
                if (request !== this.userRequest) return;
                const count =
                    data.limit === undefined ? data.count : `${data.count} of ${data.limit}`;
                this.training.set({
                    pending: false,
                    status: `${count} feedback posts saved.`,
                    link: ''
                });
            } else {
                const data = await this.api.trainModel(user);
                if (request !== this.userRequest) return;
                this.training.set({
                    pending: false,
                    status: 'Training submitted. Your personal model will be used when training succeeds.',
                    link: data.log_url || ''
                });
            }
        } catch (error) {
            if (request === this.userRequest) {
                this.training.set({
                    pending: false,
                    status: error instanceof Error ? error.message : 'Request failed.',
                    link: ''
                });
            }
        }
    }
}
