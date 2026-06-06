CC      = gcc
CFLAGS  = -O2 -Wall -Wextra -std=c11
TARGET  = pir_daemon
SRC     = pir_daemon.c

.PHONY: all clean

all: $(TARGET)

$(TARGET): $(SRC)
	$(CC) $(CFLAGS) -o $@ $^

clean:
	rm -f $(TARGET)
