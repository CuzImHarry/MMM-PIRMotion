/*
 * pir_daemon.c — HC-SR501 motion sensor daemon for Rock Pi 4
 *
 * Uses Linux sysfs GPIO edge-triggered interrupt (poll) on the PIR OUT pin.
 * Communicates with the MagicMirror node_helper via a Unix domain socket.
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
 *   ./pir_daemon [-g <gpio_number>] [-s <socket_path>]
 *   Defaults: gpio=36, socket=/tmp/mmm-pir.sock
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <errno.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/stat.h>
#include <time.h>

#define SYSFS_GPIO_BASE  "/sys/class/gpio"
#define MAX_PATH         256
#define SOCK_BACKLOG     4

static volatile int running = 1;
static int gpio_num = 36;           /* Physical pin 13, GPIO1_A4 */
static const char *sock_path = "/tmp/mmm-pir.sock";

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

/* ── Unix socket server ─────────────────────────────────────── */
static int create_server_socket(void) {
    int sfd = socket(AF_UNIX, SOCK_STREAM, 0);
    if (sfd < 0) { perror("socket"); return -1; }

    struct sockaddr_un addr;
    memset(&addr, 0, sizeof(addr));
    addr.sun_family = AF_UNIX;
    strncpy(addr.sun_path, sock_path, sizeof(addr.sun_path) - 1);

    unlink(sock_path);
    if (bind(sfd, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
        perror("bind"); close(sfd); return -1;
    }
    chmod(sock_path, 0666);
    if (listen(sfd, SOCK_BACKLOG) < 0) {
        perror("listen"); close(sfd); return -1;
    }
    return sfd;
}

/* Broadcast a JSON line to all connected clients */
#define MAX_CLIENTS 8
static int clients[MAX_CLIENTS];
static int n_clients = 0;

static void broadcast(const char *msg) {
    int i = 0;
    while (i < n_clients) {
        ssize_t n = write(clients[i], msg, strlen(msg));
        if (n < 0) {
            /* client disconnected — remove from list */
            close(clients[i]);
            clients[i] = clients[--n_clients];
        } else {
            i++;
        }
    }
}

static void accept_new_client(int sfd) {
    int cfd = accept(sfd, NULL, NULL);
    if (cfd < 0) return;
    if (n_clients < MAX_CLIENTS) {
        /* make non-blocking so a slow client can't stall us */
        int flags = fcntl(cfd, F_GETFL, 0);
        fcntl(cfd, F_SETFL, flags | O_NONBLOCK);
        clients[n_clients++] = cfd;
    } else {
        close(cfd);
    }
}

/* ── main ───────────────────────────────────────────────────── */
int main(int argc, char *argv[]) {
    /* parse args */
    for (int i = 1; i < argc - 1; i++) {
        if (strcmp(argv[i], "-g") == 0) gpio_num = atoi(argv[i + 1]);
        if (strcmp(argv[i], "-s") == 0) sock_path = argv[i + 1];
    }

    signal(SIGINT,  sig_handler);
    signal(SIGTERM, sig_handler);
    signal(SIGPIPE, SIG_IGN);   /* ignore broken pipe on client disconnect */

    fprintf(stderr, "[pir_daemon] GPIO=%d  socket=%s\n", gpio_num, sock_path);

    /* configure GPIO */
    if (gpio_export(gpio_num) < 0)            { return 1; }
    if (gpio_set_direction(gpio_num, "in") < 0) { gpio_unexport(gpio_num); return 1; }
    if (gpio_set_edge(gpio_num, "both") < 0)  { gpio_unexport(gpio_num); return 1; }

    int gpio_fd = gpio_open_value(gpio_num);
    if (gpio_fd < 0) { perror("open gpio value"); gpio_unexport(gpio_num); return 1; }

    int srv_fd = create_server_socket();
    if (srv_fd < 0) { close(gpio_fd); gpio_unexport(gpio_num); return 1; }

    /* initial read to clear any pending interrupt */
    gpio_read_value(gpio_fd);

    fprintf(stderr, "[pir_daemon] ready, listening for motion on GPIO%d\n", gpio_num);

    /*
     * poll on two fds:
     *   [0] gpio value file — POLLPRI fires on edge interrupt
     *   [1] server socket   — POLLIN fires on new client connection
     */
    struct pollfd fds[2];
    fds[0].fd      = gpio_fd;
    fds[0].events  = POLLPRI | POLLERR;
    fds[1].fd      = srv_fd;
    fds[1].events  = POLLIN;

    while (running) {
        int ret = poll(fds, 2, 1000);  /* 1 s timeout so we can check running */
        if (ret < 0) {
            if (errno == EINTR) continue;
            perror("poll"); break;
        }

        /* new client connection */
        if (fds[1].revents & POLLIN) {
            accept_new_client(srv_fd);
        }

        /* GPIO edge interrupt */
        if (fds[0].revents & (POLLPRI | POLLERR)) {
            int val = gpio_read_value(gpio_fd);
            if (val < 0) continue;

            /* build ISO-8601 timestamp */
            time_t now = time(NULL);
            struct tm *tm_info = gmtime(&now);
            char ts[32];
            strftime(ts, sizeof(ts), "%Y-%m-%dT%H:%M:%SZ", tm_info);

            char msg[128];
            snprintf(msg, sizeof(msg),
                     "{\"event\":\"%s\",\"gpio\":%d,\"ts\":\"%s\"}\n",
                     val ? "motion_start" : "motion_end", gpio_num, ts);

            fprintf(stderr, "[pir_daemon] %s", msg);
            broadcast(msg);
        }
    }

    fprintf(stderr, "[pir_daemon] shutting down\n");
    for (int i = 0; i < n_clients; i++) close(clients[i]);
    close(srv_fd);
    close(gpio_fd);
    gpio_unexport(gpio_num);
    unlink(sock_path);
    return 0;
}
