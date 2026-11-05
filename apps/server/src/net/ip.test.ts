import { describe, expect, test } from 'vitest';
import { isMetadataAddress, isPrivateAddress } from './ip';

describe('isPrivateAddress', () => {
  test.each([
    '0.0.0.0',
    '10.1.2.3',
    '127.0.0.1',
    '169.254.1.1',
    '172.16.0.1',
    '172.20.0.1',
    '172.31.255.255',
    '192.0.0.8',
    '192.168.1.10',
    '198.18.0.1',
    '198.19.255.255',
    '100.64.0.1',
    '100.127.255.255',
    '224.0.0.1',
    '240.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    'fd12::1',
    'fc00::1',
    'fe80::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '64:ff9b::a00:1',
    '64:ff9b::10.0.0.1',
    '::7f00:1',
    '::127.0.0.1',
    '::10.0.0.1',
    '::a9fe:a9fe',
    '2002:7f00:1::',
    '2002:a00:1::1',
    '2002:c0a8:101::',
    '2002:a9fe:a9fe::',
    '64:ff9b:1::',
    '64:ff9b:1:a00:0:100::',
    '64:ff9b:1:7f00:0:100::',
    '64:ff9b:1:808:8:800::',
    '64:ff9b:1:ffff:ffff:ffff:ffff:ffff',
    '::ffff:0:808:808',
    '::ffff:0:0:0',
    '2001:0:4136:e378:8000:63bf:3fff:fdd2',
    '2001::1',
    'fec0::1',
    'feff:ffff::1',
    '100::',
    '100::ffff:ffff:ffff:ffff',
    '2001:db8::1',
    '2001:db8:ffff:ffff::1',
  ])('%s is private', (ip) => expect(isPrivateAddress(ip)).toBe(true));

  test.each([
    '8.8.8.8',
    '1.1.1.1',
    '172.32.0.1',
    '172.15.255.255',
    '100.128.0.1',
    '198.20.0.1',
    '2606:4700:4700::1111',
    '::ffff:8.8.8.8',
    '64:ff9b::808:808',
    '::8.8.8.8',
    '2002:808:808::',
    '100:0:0:1::1',
    '2001:db9::1',
    '2001:db7:ffff::1',
  ])('%s is public', (ip) => expect(isPrivateAddress(ip)).toBe(false));

  test('unparseable input is treated as private (fail closed)', () => {
    expect(isPrivateAddress('not-an-ip')).toBe(true);
  });
});

describe('isMetadataAddress', () => {
  test.each([
    '169.254.169.254',
    'fd00:ec2::254',
    '100.100.100.200',
    '::ffff:169.254.169.254',
    '2002:a9fe:a9fe::',
    '::a9fe:a9fe',
  ])('%s is metadata', (ip) => expect(isMetadataAddress(ip)).toBe(true));
  test.each(['8.8.8.8', '169.254.1.1', '10.0.0.1'])('%s is not metadata', (ip) =>
    expect(isMetadataAddress(ip)).toBe(false),
  );
});

test('metadata addresses are still found inside the local-use NAT64 range', () => {
  expect(isMetadataAddress('64:ff9b:1:a9fe:a9:fe00::')).toBe(true);
  expect(isMetadataAddress('64:ff9b:1:808:8:800::')).toBe(false);
});
