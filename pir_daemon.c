/*
 * pir_daemon.c — HC-SR501 motion sensor daemon for Rock Pi 4
 *
 * Uses Linux sysfs GPIO edge-triggered interrupt (poll POLLPRI).
 * Writes JSON events to stdout, read by the MagicMirror node_helper via pipe.
 *
 * Rock Pi 4 GPIO numbering (sysfs):
 *   Physical pin 7  = GPIO1_A0  = sysfs gpio 32
 *   Physical pin 11 = GPIO1_A3  = sysfs gpio 35
 *   Physical pin 13 = GPIO1_A4  = sysfs gpio 36  (default, change via -g flag)
 *
 * Build:
 *   gcc -O2 -Wall -o pir_daemon pir_daemon.c
 *
 * Usage:
 *   ./pir_daemon [-g <gpio_number>]
 *   Default: gpio=36
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <errno.h>
#include <time.h>

#define SYSFS_GPIO_BASE  "/sys/class/gpio"
#define MAX_PATH         256

static volatile int running = 1;
static int gpio_num = 36;

/* ── signal handling ─────────────────────────────────────────── */
static void sig_handler(int sig) {
    (void)sig;
    running = 0;
}

/* ── sysfs GPIO helpers ─────────────────────────────────────── */
static int sysfs_write(const char *path, const char *val) {
    int fd = open(path, O_WRONLY);
    if (fd < 0) { perror(path); return -1; }
    ssize_t n = write(fd, val, strlen(val));
    close(fd);
    return (n < 0) ? -1 : 0;
}

static int gpio_export(int gpio) {
    char path[MAX_PATH];
    snprintf(path, sizeof(path), SYSFS_GPIO_BASE "/gpio%d", gpio);
    if (access(path, F_OK) == 0) return 0;   /* already exported */

    char buf[16];
    snprintf(buf, sizeof(buf), "%d", gpio);
    if (sysfs_write(SYSFS_GPIO_BASE "/export", buf) < 0) return -1;
    usleep(100000);   /* kernel needs a moment to create the sysfs node */
    return 0;
}

static int gpio_unexport(int gpio) {
    char buf[16];
    snprintf(buf, sizeof(buf), "%d", gpio);
    return sysfs_write(SYSFS_GPIO_BASE "/unexport", buf);
}

static int gpio_set_direction(int gpio, const char *dir) {
    char path[MAX_PATH];
    snprintf(path, sizeof(path), SYSFS_GPIO_BASE "/gpio%d/direction", gpio);
    return sysfs_write(path, dir);
}

static int gpio_set_edge(int gpio, const char *edge) {
    char path[MAX_PATH];
    snprintf(path, sizeof(path), SYSFS_GPIO_BASE "/gpio%d/edge", gpio);
    return sysfs_write(path, edge);
}

static int gpio_open_value(int gpio) {
    char path[MAX_PATH];
    snprintf(path, sizeof(path), SYSFS_GPIO_BASE "/gpio%d/value", gpio);
    return open(path, O_RDONLY | O_NONBLOCK);
}

static int gpio_read_value(int fd) {
    char buf[4] = {0};
    lseek(fd, 0, SEEK_SET);
    if (read(fd, buf, 1) < 0) return -1;
    return (buf[0] == '1') ? 1 : 0;
}

/* ── main ───────────────────────────────────────────────────── */
int main(int argc, char *argv[]) {
    for (int i = 1; i < argc - 1; i++) {
        if (strcmp(argv[i], "-g") == 0) gpio_num = atoi(argv[i + 1]);
    }

    signal(SIGINT,  sig_handler);
    signal(SIGTERM, sig_handler);

    fprintf(stderr, "[pir_daemon] GPIO=%d\n", gpio_num);

    if (gpio_export(gpio_num) < 0)              return 1;
    if (gpio_set_direction(gpio_num, "in") < 0) { gpio_unexport(gpio_num); return 1; }
    if (gpio_set_edge(gpio_num, "both") < 0)    { gpio_unexport(gpio_num); return 1; }

    int gpio_fd = gpio_open_value(gpio_num);
    if (gpio_fd < 0) { perror("open gpio value"); gpio_unexport(gpio_num); return 1; }

    /* initial read to clear any pending interrupt */
    gpio_read_value(gpio_fd);

    fprintf(stderr, "[pir_daemon] ready, listening for motion on GPIO%d\n", gpio_num);

    struct pollfd pfd = { .fd = gpio_fd, .events = POLLPRI | POLLERR };

    while (running) {
        int ret = poll(&pfd, 1, 1000);
        if (ret < 0) {
            if (errno == EINTR) continue;
            perror("poll"); break;
        }

        if (pfd.revents & (POLLPRI | POLLERR)) {
            int val = gpio_read_value(gpio_fd);
            if (val < 0) continue;

            time_t now = time(NULL);
            struct tm *tm_info = gmtime(&now);
            char ts[32];
            strftime(ts, sizeof(ts), "%Y-%m-%dT%H:%M:%SZ", tm_info);

            printf("{\"event\":\"%s\",\"gpio\":%d,\"ts\":\"%s\"}\n",
                   val ? "motion_start" : "motion_end", gpio_num, ts);
            fflush(stdout);
        }
    }

    fprintf(stderr, "[pir_daemon] shutting down\n");
    close(gpio_fd);
    gpio_unexport(gpio_num);
    return 0;
}
