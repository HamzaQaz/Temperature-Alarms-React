import { TEST_DEVICE_TOKEN } from './server';

/** A firmware image as the Arduino build signs it: ESP image magic, the version marker, a signature, its length. */
export function image(version: number, { signatureLength = 256, marker = true, magic = 0xe9 } = {}): Buffer {
  const body = Buffer.concat([
    Buffer.from([magic, 0x01, 0x02, 0x03]),
    Buffer.alloc(1000, 0x55),
    Buffer.from(marker ? `TA-FIRMWARE-VERSION=${version}\0` : 'nothing here\0'),
    Buffer.alloc(500, 0xaa),
  ]);
  const signature = Buffer.alloc(signatureLength, 0x5a);
  const length = Buffer.alloc(4);
  length.writeUInt32LE(signatureLength);
  return Buffer.concat([body, signature, length]);
}

/** As the board's update check sends it: the Device token as Basic credentials, its MAC and version. */
export const check = (
  url: string,
  { mac = '5C:CF:7F:A1:B2:C3', version = '1', token = TEST_DEVICE_TOKEN, address }: { mac?: string; version?: string; token?: string; address?: string } = {},
) =>
  fetch(`${url}/api/firmware`, {
    headers: {
      Authorization: `Basic ${Buffer.from(`device:${token}`).toString('base64')}`,
      'x-ESP8266-STA-MAC': mac,
      'x-ESP8266-version': version,
      ...(address === undefined ? {} : { 'X-Forwarded-For': address }),
    },
  });
