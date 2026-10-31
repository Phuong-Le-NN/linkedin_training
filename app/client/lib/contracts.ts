export type FilterMode = 'blur' | 'hide';

export interface FeedSettings {
    isEnabled: boolean;
    filterMode: FilterMode;
}

export type ExtensionRequest =
    | { type: 'classifyPost'; text: string }
    | { type: 'saveFeedback'; text: string; useful: boolean };

export interface ClassificationResponse {
    label: 'useful' | 'useless';
}

export interface FeedbackResponse {
    saved: true;
}

export interface FeedbackCountResponse {
    count: number;
    limit?: number;
}

export interface TrainingResponse {
    build_id?: string | null;
    log_url?: string | null;
}

export interface TokenUser {
    getIdToken(): Promise<string>;
}
