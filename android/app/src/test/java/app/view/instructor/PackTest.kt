package app.view.instructor

import org.junit.Assert.assertArrayEquals
import org.junit.Test

class PackTest {
    // Must match packChunk in src/screenShare.ts, which viewers decode with unpackChunk.
    @Test
    fun matchesBrowserChunkFormat() {
        val packed = ScreenShareService.pack(true, 1234, byteArrayOf(7, 8, 9))
        val expected = byteArrayOf(1) +
            java.nio.ByteBuffer.allocate(8).order(java.nio.ByteOrder.LITTLE_ENDIAN).putDouble(1234.0).array() +
            byteArrayOf(7, 8, 9)
        assertArrayEquals(expected, packed)
        assertArrayEquals(byteArrayOf(0), ScreenShareService.pack(false, 0, ByteArray(0)).copyOf(1))
    }
}
