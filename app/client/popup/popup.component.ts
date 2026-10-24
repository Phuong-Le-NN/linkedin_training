import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import type { OnDestroy } from '@angular/core';
import { createUserWithEmailAndPassword, onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth/web-extension';
import { auth } from '../lib/auth.js';
import { API_BASE_URL } from '../lib/api_config.js';
@Component({
    selector: 'lvg-popup',
    standalone: true,
    templateUrl: './popup.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class PopupComponent implements OnInit, OnDestroy {
    readonly enabled = signal(false);
    readonly mode = signal<'blur' | 'remove'>('blur');
    readonly pending = signal(false);
    readonly status = signal('Loading preferences...');
    readonly error = signal('');
    readonly user = signal<User | null>(null);
    readonly authPending = signal(false);
    private unsubscribe?: () => void;

    ngOnInit(): void {
        void this.loadSettings();
        this.unsubscribe = onAuthStateChanged(auth, (user) => {
            this.user.set(user);
            this.error.set('');
        }, () => this.error.set('Could not load sign-in state.'));
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
    ngOnDestroy(): void {
        this.unsubscribe?.();
    }

    async authenticate(event: SubmitEvent, email: HTMLInputElement, password: HTMLInputElement): Promise<void> {
        event.preventDefault();
        this.authPending.set(true);
        this.error.set('');
        try {
            const create = (event.submitter as HTMLButtonElement | null)?.value === 'sign-up';
            const authenticate = create ? createUserWithEmailAndPassword : signInWithEmailAndPassword;
            await authenticate(auth, email.value.trim(), password.value);
            email.value = password.value = '';
        } catch {
            this.error.set('Could not sign in or create your account.');
        } finally {
            this.authPending.set(false);
        }
    }

    async signOut(): Promise<void> {
        try {
            await signOut(auth);
        } catch {
            this.error.set('Could not sign out.');
        }
    }

    countFeedback(): Promise<void> {
        return this.runUserAction('/feedback/count', 'GET');
    }

    trainModel(): Promise<void> {
        return this.runUserAction('/train', 'POST');
    }

    private async runUserAction(path: string, method: string): Promise<void> {
        const user = this.user();
        if (!user || this.pending()) return;
        this.pending.set(true);
        this.error.set('');
        try {
            const response = await fetch(API_BASE_URL + path, {
                method,
                headers: { Authorization: `Bearer ${await user.getIdToken()}` }
            });
            const result = await response.json() as { detail?: string; count?: number };
            if (!response.ok) throw new Error(result.detail || 'Request failed.');
            if (auth.currentUser?.uid !== user.uid) return;
            this.status.set(path === '/feedback/count'
                ? `${result.count} feedback posts saved.`
                : 'Training submitted. The model will be available when the build succeeds.');
        } catch (error) {
            this.error.set(error instanceof Error ? error.message : 'Request failed.');
        } finally {
            this.pending.set(false);
        }
    }

}
