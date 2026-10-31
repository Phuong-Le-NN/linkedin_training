import { Injectable } from '@angular/core';
import {
    createUserWithEmailAndPassword,
    onAuthStateChanged,
    signInWithEmailAndPassword,
    signOut,
    type User
} from 'firebase/auth/web-extension';
import { auth } from '../lib/auth.js';
import { getFeedbackCount, trainModel } from '../lib/api.js';
import { getSettings, updateSettings } from '../lib/settings.js';
import type { FeedSettings, FeedbackCountResponse, TrainingResponse } from '../lib/contracts';

@Injectable({ providedIn: 'root' })
export class PopupService {
    watchUser(onUser: (user: User | null) => void, onError: () => void): () => void {
        return onAuthStateChanged(auth, onUser, onError);
    }

    async authenticate(email: string, password: string, createAccount: boolean): Promise<void> {
        const authenticate = createAccount
            ? createUserWithEmailAndPassword
            : signInWithEmailAndPassword;
        await authenticate(auth, email.trim(), password);
    }

    signOut(): Promise<void> {
        return signOut(auth);
    }

    getSettings(): Promise<FeedSettings> {
        return getSettings();
    }

    updateSettings(changes: Partial<FeedSettings>): Promise<FeedSettings> {
        return updateSettings(changes);
    }

    openGuide(): Promise<void> {
        return chrome.runtime.openOptionsPage();
    }

    getFeedbackCount(user: User): Promise<FeedbackCountResponse> {
        return getFeedbackCount(user);
    }

    trainModel(user: User): Promise<TrainingResponse> {
        return trainModel(user);
    }
}
