const STORAGE_KEY = 'pathmap_session';

/**
 * Save session to localStorage
 */
export function saveToLocalStorage(state) {
    try {
        const serialized = JSON.stringify(state);
        localStorage.setItem(STORAGE_KEY, serialized);
    } catch (error) {
        console.error('Failed to save to localStorage:', error);
    }
}

/**
 * Load session from localStorage
 */
export function loadFromLocalStorage() {
    try {
        const serialized = localStorage.getItem(STORAGE_KEY);
        if (serialized) {
            return JSON.parse(serialized);
        }
    } catch (error) {
        console.error('Failed to load from localStorage:', error);
    }
    return null;
}

/**
 * Download session as JSON file
 */
export function downloadSession(state) {
    const data = JSON.stringify(state, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `pathmap-session-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * Upload session from JSON file
 */
export function uploadSession(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (e) => {
            try {
                const state = JSON.parse(e.target.result);
                resolve(state);
            } catch (error) {
                reject(new Error('Invalid JSON file'));
            }
        };

        reader.onerror = () => {
            reject(new Error('Failed to read file'));
        };

        reader.readAsText(file);
    });
}

/**
 * Clear all stored data
 */
export function clearStorage() {
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
        console.error('Failed to clear storage:', error);
    }
}
