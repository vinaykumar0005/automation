// src/main/automation/antidetection/webgpuProtection.ts
/**
 * WebGPU Protection
 * Next-gen graphics API fingerprinting defense
 */

import type { Page, BrowserContext } from 'playwright';

/**
 * Apply WebGPU fingerprinting protections to a page or browser context
 */
export async function applyWebGPUProtection(target: Page | BrowserContext): Promise<void> {
  await target.addInitScript(() => {
    // 1. Spoof GPU adapter information to prevent fingerprinting
    if ('gpu' in navigator) {
      const originalGPU = navigator.gpu;
      if (originalGPU && typeof originalGPU.requestAdapter === 'function') {
        // Spoof the GPU object by overriding its requestAdapter method
        const originalRequestAdapter = originalGPU.requestAdapter;
        Object.defineProperty(originalGPU, 'requestAdapter', {
          value: async function(options?: GPURequestAdapterOptions) {
            const adapter = await originalRequestAdapter.call(this, options);
            if (!adapter) {
              // Return a mock adapter if the original fails
              return {
                // GPUAdapter interface
                features: [] as unknown as GPUSupportedFeatures,
                limits: {
                  maxTextureDimension1D: 8192,
                  maxTextureDimension2D: 8192,
                  maxTextureDimension3D: 2048,
                  maxTextureArrayLayers: 256,
                  maxBindGroups: 4,
                  maxBindingsPerBindGroup: 1000,
                  maxDynamicUniformBuffersPerPipelineLayout: 8,
                  maxDynamicStorageBuffersPerPipelineLayout: 4,
                  maxSampledTexturesPerShaderStage: 16,
                  maxSamplersPerShaderStage: 16,
                  maxStorageBuffersPerShaderStage: 8,
                  maxStorageTexturesPerShaderStage: 4,
                  maxUniformBuffersPerShaderStage: 12,
                  maxUniformBufferBindingSize: 65536,
                  maxStorageBufferBindingSize: 134217728,
                  minUniformBufferOffsetAlignment: 256,
                  minStorageBufferOffsetAlignment: 256,
                  maxVertexBuffers: 8,
                  maxBufferSize: 268435456,
                  maxVertexAttributes: 16,
                  maxVertexBufferArrayStride: 2048,
                  maxInterStageShaderComponents: 60,
                  maxInterStageShaderVariables: 16,
                  maxColorAttachments: 8,
                  maxColorAttachmentBytesPerSample: 32,
                  maxComputeWorkgroupStorageSize: 16384,
                  maxComputeInvocationsPerWorkgroup: 256,
                  maxComputeWorkgroupSizeX: 256,
                  maxComputeWorkgroupSizeY: 256,
                  maxComputeWorkgroupSizeZ: 64,
                  maxComputeWorkgroupsPerDimension: 65535,
                  maxBindGroupsPlusVertexBuffers: 24
                } as GPUSupportedLimits,
                // Required info property
                info: {
                  vendor: '',
                  architecture: '',
                  device: '',
                  description: ''
                } as GPUAdapterInfo,
                // Methods
                requestDevice: async (descriptor?: GPUDeviceDescriptor) => {
                  // Return a mock device with protected properties
                  const originalDevice = (adapter as any)?.requestDevice?.call(adapter, descriptor);
                  if (!originalDevice) {
                    // Create a minimal mock device
                    return {
                      // GPUDevice interface
                      destroy: () => {},
                      pushErrorScope: () => Promise.resolve('no-error'),
                      popErrorScope: () => Promise.resolve('no-error'),
                      lost: Promise.resolve(),
                      // Add other required properties to satisfy GPUDevice interface
                      ...(adapter && typeof adapter === 'object' ? adapter : {}),
                      limits: {
                        maxTextureDimension1D: 8192,
                        maxTextureDimension2D: 8192,
                        maxTextureDimension3D: 2048,
                        maxTextureArrayLayers: 256,
                        maxBindGroups: 4,
                        maxBindingsPerBindGroup: 1000,
                        maxDynamicUniformBuffersPerPipelineLayout: 8,
                        maxDynamicStorageBuffersPerPipelineLayout: 4,
                        maxSampledTexturesPerShaderStage: 16,
                        maxSamplersPerShaderStage: 16,
                        maxStorageBuffersPerShaderStage: 8,
                        maxStorageTexturesPerShaderStage: 4,
                        maxUniformBuffersPerShaderStage: 12,
                        maxUniformBufferBindingSize: 65536,
                        maxStorageBufferBindingSize: 134217728,
                        minUniformBufferOffsetAlignment: 256,
                        minStorageBufferOffsetAlignment: 256,
                        maxVertexBuffers: 8,
                        maxBufferSize: 268435456,
                        maxVertexAttributes: 16,
                        maxVertexBufferArrayStride: 2048,
                        maxInterStageShaderComponents: 60,
                        maxInterStageShaderVariables: 16,
                        maxColorAttachments: 8,
                        maxColorAttachmentBytesPerSample: 32,
                        maxComputeWorkgroupStorageSize: 16384,
                        maxComputeInvocationsPerWorkgroup: 256,
                        maxComputeWorkgroupSizeX: 256,
                        maxComputeWorkgroupSizeY: 256,
                        maxComputeWorkgroupSizeZ: 64,
                        maxComputeWorkgroupsPerDimension: 65535,
                        maxBindGroupsPlusVertexBuffers: 24
                      } as GPUSupportedLimits
                    } as unknown as GPUDevice;
                  }
                  return originalDevice;
                }
              } as unknown as GPUAdapter;
            }

            // Protect the adapter's limits and features to prevent fingerprinting
            const protectedAdapter = {
              ...(adapter && typeof adapter === 'object' ? adapter : {} as any),
              // Return standardized limits that don't reveal specific hardware
              limits: {
                maxTextureDimension1D: 8192,
                maxTextureDimension2D: 8192,
                maxTextureDimension3D: 2048,
                maxTextureArrayLayers: 256,
                maxBindGroups: 4,
                maxBindingsPerBindGroup: 1000,
                maxDynamicUniformBuffersPerPipelineLayout: 8,
                maxDynamicStorageBuffersPerPipelineLayout: 4,
                maxSampledTexturesPerShaderStage: 16,
                maxSamplersPerShaderStage: 16,
                maxStorageBuffersPerShaderStage: 8,
                maxStorageTexturesPerShaderStage: 4,
                maxUniformBuffersPerShaderStage: 12,
                maxUniformBufferBindingSize: 65536,
                maxStorageBufferBindingSize: 134217728,
                minUniformBufferOffsetAlignment: 256,
                minStorageBufferOffsetAlignment: 256,
                maxVertexBuffers: 8,
                maxBufferSize: 268435456,
                maxVertexAttributes: 16,
                maxVertexBufferArrayStride: 2048,
                maxInterStageShaderComponents: 60,
                maxInterStageShaderVariables: 16,
                maxColorAttachments: 8,
                maxColorAttachmentBytesPerSample: 32,
                maxComputeWorkgroupStorageSize: 16384,
                maxComputeInvocationsPerWorkgroup: 256,
                maxComputeWorkgroupSizeX: 256,
                maxComputeWorkgroupSizeY: 256,
                maxComputeWorkgroupSizeZ: 64,
                maxComputeWorkgroupsPerDimension: 65535,
                maxBindGroupsPlusVertexBuffers: 24
              } as unknown as GPUSupportedLimits
            };

            return protectedAdapter as unknown as GPUAdapter;
          },
          configurable: true
        });
      }
    }

    // 2. Protect against WebGPU feature detection
    if ('gpu' in navigator && navigator.gpu && typeof navigator.gpu.requestAdapter === 'function') {
      // Override feature detection to return consistent results
      const originalRequestAdapter = navigator.gpu.requestAdapter;
      Object.defineProperty(navigator.gpu, 'requestAdapter', {
        value: async function(options?: GPURequestAdapterOptions) {
          const adapter = await originalRequestAdapter.call(this, options);
          if (!adapter) return adapter;

          // Spoof features to return a standard set
          const protectedAdapter = {
            ...(adapter && typeof adapter === 'object' ? adapter : {} as any),
            features: [] as unknown as GPUSupportedFeatures // Return empty features array to avoid fingerprinting
            // In practice, you might want to return a common subset of features
          };

          // Also protect the requestDevice method on the adapter
          const originalRequestDevice = adapter.requestDevice;
          if (typeof originalRequestDevice === 'function') {
            Object.defineProperty(protectedAdapter, 'requestDevice', {
              value: async function(descriptor?: GPUDeviceDescriptor) {
                const device = await originalRequestDevice.call(this, descriptor);
                if (!device) return device;

                // Protect device properties that could be used for fingerprinting
                const protectedDevice = {
                  ...(device && typeof device === 'object' ? device : {} as any),
                  features: [] as unknown as GPUSupportedFeatures,
                  // Ensure limits are standardized
                  limits: {
                    maxTextureDimension1D: 8192,
                    maxTextureDimension2D: 8192,
                    maxTextureDimension3D: 2048,
                    maxTextureArrayLayers: 256,
                    maxBindGroups: 4,
                    maxBindingsPerBindGroup: 1000,
                    maxDynamicUniformBuffersPerPipelineLayout: 8,
                    maxDynamicStorageBuffersPerPipelineLayout: 4,
                    maxSampledTexturesPerShaderStage: 16,
                    maxSamplersPerShaderStage: 16,
                    maxStorageBuffersPerShaderStage: 8,
                    maxStorageTexturesPerShaderStage: 4,
                    maxUniformBuffersPerShaderStage: 12,
                    maxUniformBufferBindingSize: 65536,
                    maxStorageBufferBindingSize: 134217728,
                    minUniformBufferOffsetAlignment: 256,
                    minStorageBufferOffsetAlignment: 256,
                    maxVertexBuffers: 8,
                    maxBufferSize: 268435456,
                    maxVertexAttributes: 16,
                    maxVertexBufferArrayStride: 2048,
                    maxInterStageShaderComponents: 60,
                    maxInterStageShaderVariables: 16,
                    maxColorAttachments: 8,
                    maxColorAttachmentBytesPerSample: 32,
                    maxComputeWorkgroupStorageSize: 16384,
                    maxComputeInvocationsPerWorkgroup: 256,
                    maxComputeWorkgroupSizeX: 256,
                    maxComputeWorkgroupSizeY: 256,
                    maxComputeWorkgroupSizeZ: 64,
                    maxComputeWorkgroupsPerDimension: 65535,
                    maxBindGroupsPlusVertexBuffers: 24
                  } as unknown as GPUSupportedLimits
                };

                return protectedDevice as unknown as GPUDevice;
              },
              configurable: true
            });
          }

          return protectedAdapter as unknown as GPUAdapter;
        },
        configurable: true
      });
    }

    // 3. Protect against WebGPU context attribute leakage
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(contextId: string, contextOptions?: any) {
      if (contextId === 'webgpu' || contextId === 'gpibit') {
        // For WebGPU contexts, we've already protected the adapter/device above
        // Additional context-specific protections could go here
      }
      return originalGetContext.call(this, contextId, contextOptions) as any;
    };

    // 4. Normalize WebGPU-related timing to prevent timing attacks
    if ('performance' in window && performance.now) {
      const originalNow = performance.now.bind(performance);
      performance.now = function() {
        // Add subtle jitter to prevent precise timing measurements
        // that could be used to infer GPU performance characteristics
        const jitter = (Math.random() * 0.1) - 0.05; // ±0.05ms
        return originalNow() + jitter;
      };
    }

    // 5. Hide WebGPU-specific properties that indicate automation
    // We don't delete these as they're part of the standard interface
    // Instead, we ensure they behave consistently through our adapter/device spoofing
  });
}

export default { applyWebGPUProtection };