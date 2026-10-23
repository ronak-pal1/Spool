const MIME_CANDIDATES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

export function pickMimeType(): string {
  for (const mime of MIME_CANDIDATES) if (MediaRecorder.isTypeSupported(mime)) return mime;
  return '';
}

export function stopStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((track) => track.stop());
}

export function openMicrophone(deviceId: string | null): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
}

export function openCamera(deviceId: string | null, ideal: { width: number; height: number } = { width: 1280, height: 720 }): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      width: { ideal: ideal.width },
      height: { ideal: ideal.height },
      frameRate: { ideal: 30 },
    },
  });
}

export function describeMediaError(error: unknown): string {
  const name = (error as DOMException | undefined)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Permission was denied. Grant camera and microphone access from the Spool popup and try again.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'The selected device is not available. Pick another one in the Spool popup.';
  if (name === 'NotReadableError') return 'The device is in use by another application.';
  if (name === 'AbortError') return 'Capture was cancelled.';
  return error instanceof Error ? error.message : 'Could not start capture.';
}

export type PermissionKind = 'microphone' | 'camera';
export type PermissionValue = PermissionState | 'unsupported';

export async function queryPermission(kind: PermissionKind): Promise<PermissionValue> {
  try {
    const status = await navigator.permissions.query({ name: kind as PermissionName });
    return status.state;
  } catch {
    return 'unsupported';
  }
}

export interface MediaDeviceOption {
  deviceId: string;
  label: string;
}

export async function listDevices(): Promise<{ microphones: MediaDeviceOption[]; cameras: MediaDeviceOption[] }> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const toOption = (device: MediaDeviceInfo, index: number, fallback: string): MediaDeviceOption => ({
    deviceId: device.deviceId,
    label: device.label || `${fallback} ${index + 1}`,
  });
  const microphones = devices.filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'communications');
  const cameras = devices.filter((d) => d.kind === 'videoinput' && d.deviceId);
  return {
    microphones: microphones.map((d, i) => toOption(d, i, 'Microphone')),
    cameras: cameras.map((d, i) => toOption(d, i, 'Camera')),
  };
}
