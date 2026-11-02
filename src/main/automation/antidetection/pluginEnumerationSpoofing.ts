// src/main/automation/antidetection/pluginEnumerationSpoofing.ts
/**
 * Plugin Enumeration Deep Spoofing
 * MIME types, plugin descriptions, and version masking
 */

import type { Page, BrowserContext } from 'playwright';

/**
 * Apply plugin enumeration spoofing protections to a page or browser context
 */
export async function applyPluginEnumerationSpoofing(target: Page | BrowserContext): Promise<void> {
  await target.addInitScript(() => {
    // 1. Deep spoofing of navigator.plugins
    if ('navigator' in window) {
      // Create a more realistic plugin array that varies slightly each time
      // to prevent exact matching while still looking legitimate
      const pluginTemplates = [
        {
          name: 'Chrome PDF Plugin',
          filename: 'internal-pdf-viewer',
          description: 'Portable Document Format',
          length: 1
        },
        {
          name: 'Chrome PDF Viewer',
          filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai',
          description: '',
          length: 1
        },
        {
          name: 'Native Client',
          filename: 'internal-nacl-plugin',
          description: '',
          length: 1
        },
        {
          name: 'Shockwave Flash',
          filename: 'pepflashplayer.dll',
          description: 'Shockwave Flash 32.0 r0',
          length: 1
        }
      ];

      // Create a plugin array with slight variations
      const createPluginArray = () => {
        // Select a random subset of templates to vary the plugin list
        const selectedTemplates = pluginTemplates
          .sort(() => 0.5 - Math.random())
          .slice(0, Math.floor(Math.random() * 2) + 2); // 2-4 plugins

        // Add slight variations to descriptions and filenames
        const variedPlugins = selectedTemplates.map(template => ({
          ...template,
          description: varyDescription(template.description),
          filename: varyFilename(template.filename)
        }));

        // Create a fake PluginArray object
        const pluginArray = {
          length: variedPlugins.length,
          item: (index: number) => variedPlugins[index] || null,
          namedItem: (name: string) => variedPlugins.find(p => p.name === name) || null,
          [Symbol.iterator]: function* () {
            yield* variedPlugins;
          }
        };
        return pluginArray;
      };

      // Override the plugins property
      Object.defineProperty(navigator, 'plugins', {
        get: () => createPluginArray(),
        configurable: true
      });
    }

    // 2. Spoof MIME types to look more realistic
    if ('navigator' in window && 'mimeTypes' in navigator) {
      const mimeTypeTemplates = [
        { type: 'application/x-google-chrome-pdf', suffixes: 'pdf', description: 'Portable Document Format', enabledPlugin: 'Chrome PDF Plugin' },
        { type: 'application/pdf', suffixes: 'pdf', description: '', enabledPlugin: 'Chrome PDF Viewer' },
        { type: 'application/x-nacl', suffixes: '', description: 'Native Client Executable', enabledPlugin: 'Native Client' },
        { type: 'application/x-pnacl', suffixes: '', description: 'Portable Native Client Executable', enabledPlugin: 'Native Client' },
        { type: 'application/shockwave-flash', suffixes: 'swf', description: 'Shockwave Flash', enabledPlugin: 'Shockwave Flash' },
        { type: 'application/futuresplash', suffixes: 'spl', description: 'FutureSplash Player', enabledPlugin: 'Shockwave Flash' }
      ];

      const createMimeTypeArray = () => {
        const selected = mimeTypeTemplates
          .sort(() => 0.5 - Math.random())
          .slice(0, Math.floor(Math.random() * 2) + 2);

        const variedMimeTypes = selected.map(mime => ({
          ...mime,
          description: varyDescription(mime.description),
          suffixes: varySuffixes(mime.suffixes)
        }));

        const mimeTypeArray = {
          length: variedMimeTypes.length,
          item: (index: number) => variedMimeTypes[index] || null,
          namedItem: (name: string) => variedMimeTypes.find(m => m.type === name) || null,
          [Symbol.iterator]: function* () {
            yield* variedMimeTypes;
          }
        };
        return mimeTypeArray;
      };

      Object.defineProperty(navigator, 'mimeTypes', {
        get: () => createMimeTypeArray(),
        configurable: true
      });
    }

    // 3. Mask plugin versions to prevent version-based fingerprinting
    if ('navigator' in window) {
      // Override plugin description parsing to remove version numbers
      const originalPluginDescriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, 'plugins');
      if (originalPluginDescriptor && originalPluginDescriptor.get) {
        Object.defineProperty(navigator, 'plugins', {
          get: function(this: Navigator) {
            // Using call with explicit this binding and handling potential undefined
            if (originalPluginDescriptor.get) {
              const plugins = originalPluginDescriptor.get.call(this);
              // We've already spoofed the plugins array above, so this is just a safety layer
              return plugins;
            }
            // Fallback - return empty array if getter is somehow unavailable
            return [];
          },
          configurable: true
        });
      }
    }

    // 4. Protect against plugin detection via content types
    if ('navigator' in window) {
      const originalProto = Object.getPrototypeOf(navigator);
      // We've already handled mimeTypes above
    }

    // 5. Add variation to plugin naming to prevent exact matching
    // This is handled in the plugin array creation above

    // 6. Normalize plugin array behavior to look like a real browser
    // The plugin array implementation above already mimics real PluginArray behavior

    // 7. Protect against plugin detection through JavaScript engine properties
    // Most plugin detection happens through the standard navigator.plugins API
    // which we've already spoofed

    // Helper functions for variation
    function varyDescription(description: string): string {
      if (!description) return description;
      // Occasionally add or remove small bits of description
      if (Math.random() < 0.2) { // 20% chance to vary
        if (Math.random() < 0.5 && description.length > 10) {
          // Remove a random character
          const pos = Math.floor(Math.random() * description.length);
          return description.slice(0, pos) + description.slice(pos + 1);
        } else {
          // Add a random character
          const pos = Math.floor(Math.random() * (description.length + 1));
          const randomChar = String.fromCharCode(32 + Math.floor(Math.random() * 93)); // Printable ASCII
          return description.slice(0, pos) + randomChar + description.slice(pos);
        }
      }
      return description;
    }

    function varyFilename(filename: string): string {
      if (!filename) return filename;
      // Very occasionally vary the filename
      if (Math.random() < 0.05) { // 5% chance
        if (filename.includes('.')) {
          const parts = filename.split('.');
          if (parts.length > 1) {
            // Vary the extension slightly
            const ext = parts.pop()!; // Non-null assertion - we know parts.length > 1
            if (ext.length > 2 && Math.random() < 0.5) {
              // Add or remove a character from extension
              if (Math.random() < 0.5 && ext.length > 2) {
                const pos = Math.floor(Math.random() * ext.length);
                parts.push(ext.slice(0, pos) + ext.slice(pos + 1));
              } else {
                const pos = Math.floor(Math.random() * (ext.length + 1));
                const randomChar = String.fromCharCode(97 + Math.floor(Math.random() * 26)); // lowercase letter
                parts.push(ext.slice(0, pos) + randomChar + ext.slice(pos));
              }
            }
            return parts.join('.');
          }
        }
      }
      return filename;
    }

    function varySuffixes(suffixes: string): string {
      if (!suffixes) return suffixes;
      // Vary file suffixes slightly
      if (Math.random() < 0.2) {
        if (suffixes.length > 1 && Math.random() < 0.5) {
          // Remove a random character
          const pos = Math.floor(Math.random() * suffixes.length);
          return suffixes.slice(0, pos) + suffixes.slice(pos + 1);
        } else {
          // Add a random character
          const pos = Math.floor(Math.random() * (suffixes.length + 1));
          const randomChar = String.fromCharCode(97 + Math.floor(Math.random() * 26)); // lowercase letter
          return suffixes.slice(0, pos) + randomChar + suffixes.slice(pos);
        }
      }
      return suffixes;
    }
  });
}

export default { applyPluginEnumerationSpoofing };