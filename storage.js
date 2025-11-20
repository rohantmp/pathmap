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
 * Download session as .pathmap file
 */
export function downloadSession(state) {
    // Add metadata to help identify the file
    const sessionData = {
        version: '1.0',
        type: 'PathMap Session',
        created: new Date().toISOString(),
        data: state
    };

    const data = JSON.stringify(sessionData, null, 2);
    const blob = new Blob([data], { type: 'application/x-pathmap' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `pathmap-session-${new Date().toISOString().slice(0, 10)}.pathmap`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * Upload session from .pathmap or JSON file
 */
export function uploadSession(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (e) => {
            try {
                const parsed = JSON.parse(e.target.result);

                // Check if it's a new format with metadata
                if (parsed.type === 'PathMap Session' && parsed.data) {
                    resolve(parsed.data);
                } else {
                    // Legacy format or direct state object
                    resolve(parsed);
                }
            } catch (error) {
                reject(new Error('Invalid session file. Please select a valid .pathmap or JSON file.'));
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
